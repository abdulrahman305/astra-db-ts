// Copyright DataStax, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { HTTPClient } from '@/src/api';
import { setDefaultIdForInsert, setDefaultIdForUpsert, takeWhile } from './utils';
import { InsertOneCommand, InsertOneResult } from '@/src/client/types/insert/insert-one';
import {
  InsertManyCommand,
  insertManyOptionKeys,
  InsertManyOptions,
  InsertManyResult
} from '@/src/client/types/insert/insert-many';
import {
  UpdateOneCommand,
  updateOneOptionKeys,
  UpdateOneOptions,
  UpdateOneResult,
} from '@/src/client/types/update/update-one';
import { UpdateManyCommand, UpdateManyOptions, UpdateManyResult } from '@/src/client/types/update/update-many';
import { DeleteOneCommand, DeleteOneOptions, DeleteOneResult } from '@/src/client/types/delete/delete-one';
import { DeleteManyCommand, DeleteManyResult } from '@/src/client/types/delete/delete-many';
import { FindOptions } from '@/src/client/types/find/find';
import { ModifyResult } from '@/src/client/types/find/find-common';
import { FindOneCommand, FindOneOptions, findOneOptionsKeys } from '@/src/client/types/find/find-one';
import { FindOneAndDeleteCommand, FindOneAndDeleteOptions } from '@/src/client/types/find/find-one-delete';
import {
  FindOneAndUpdateCommand,
  FindOneAndUpdateOptions,
  findOneAndUpdateOptionsKeys
} from '@/src/client/types/find/find-one-update';
import {
  FindOneAndReplaceCommand,
  FindOneAndReplaceOptions,
  findOneAndReplaceOptionsKeys
} from '@/src/client/types/find/find-one-replace';
import { Filter } from '@/src/client/types/filter';
import { UpdateFilter } from '@/src/client/types/update-filter';
import { Flatten, FoundDoc, IdOf, NoId, WithId } from '@/src/client/types/utils';
import { SomeDoc } from '@/src/client/document';
import { Db } from '@/src/client/db';
import { FindCursor } from '@/src/client/cursor';
import { ToDotNotation } from '@/src/client/types/dot-notation';
import { CollectionOptions } from '@/src/client/types/collections/collection-options';
import { BaseOptions } from '@/src/client/types/common';
import { ReplaceOneOptions, ReplaceOneResult } from '@/src/client/types/update/replace-one';
import { AnyBulkWriteOperation, BulkWriteOptions, BulkWriteResult, } from '@/src/client/types/misc/bulk-write';
import {
  BulkWriteError,
  DataAPIResponseError,
  DeleteManyError,
  InsertManyError,
  mkRespErrorFromResponse,
  mkRespErrorFromResponses,
  TooManyDocsToCountError,
  UpdateManyError
} from '@/src/client/errors';
import objectHash from 'object-hash';

/**
 * Represents the interface to a collection in the database.
 *
 * **Shouldn't be directly instantiated, but rather created via {@link Db.createCollection},
 * or connected to using {@link Db.collection}**.
 *
 * Typed as `Collection<Schema>` where `Schema` is the type of the documents in the collection.
 * Operations on the collection will be strongly typed if a specific schema is provided, otherwise
 * remained largely weakly typed if no type is provided, which may be preferred for dynamic data
 * access & operations.
 *
 * @example
 * ```typescript
 * const collection = await db.createCollection<PersonSchema>('my_collection');
 * await collection.insertOne({ _id: '1', name: 'John Doe' });
 * await collection.drop();
 * ```
 *
 * @see SomeDoc
 * @see VectorDoc
 */
export class Collection<Schema extends SomeDoc = SomeDoc> {
  private readonly _collectionName: string;
  private readonly _httpClient: HTTPClient;
  private readonly _db: Db

  constructor(db: Db, httpClient: HTTPClient, name: string) {
    if (!name) {
      throw new Error('collection name is required');
    }

    this._httpClient = httpClient.withOptions({ collection: name });
    this._collectionName = name;
    this._db = db;
  }

  /**
   * @return The name of the collection.
   */
  get collectionName(): string {
    return this._collectionName;
  }

  /**
   * @return The namespace (aka keyspace) of the parent database.
   */
  get namespace(): string {
    return this._db.namespace;
  }

  /**
   * Inserts a single document into the collection atomically.
   *
   * If the document does not contain an `_id` field, an ObjectId string will be generated on the client and assigned to the
   * document. This generation will mutate the document.
   *
   * If an `_id` is provided which corresponds to a document that already exists in the collection, an error is raised,
   * and the insertion fails.
   *
   * @example
   * ```typescript
   * await collection.insertOne({ _id: '1', name: 'John Doe' });
   * await collection.insertOne({ name: 'Jane Doe' }); // _id will be generated
   * ```
   *
   * @param document - The document to insert.
   *
   * @param options - The options for the operation.
   *
   * @return InsertOneResult
   */
  async insertOne(document: Schema, options?: BaseOptions): Promise<InsertOneResult<Schema>> {
    setDefaultIdForInsert(document);

    const command: InsertOneCommand = {
      insertOne: { document },
    }

    const resp = await this._httpClient.executeCommand(command, options);

    return {
      insertedId: resp.status?.insertedIds[0],
    };
  }

  /**
   * Inserts many documents into the collection.
   *
   * **NB. This function paginates the insertion of documents in chunks to avoid running into insertion limits. This
   * means multiple requests will be made to the server, and the operation may not be atomic.**
   *
   * If any document does not contain an `_id` field, an ObjectId string will be generated on the client and assigned to
   * the document. This generation will mutate the document.
   *
   * You can set the `ordered` option to `true` to stop the operation after the first error, otherwise all documents
   * may be parallelized and processed in arbitrary order, improving, perhaps vastly, performance.
   *
   * If an insertion error occurs, the operation will throw an {@link InsertManyError} containing the partial result.
   *
   * *If the exception is not due to an insertion error, e.g. a `5xx` error or network error, the operation will throw the
   * underlying error.*
   *
   * *In case of an unordered request, if the error was a simple insertion error, a `InsertManyError` will be thrown
   * after every document has been attempted to be inserted. If it was a `5xx` or similar, the error will be thrown
   * immediately.*
   *
   * You can set the `parallel` option to control how many network requests are made in parallel on unordered
   * insertions. Defaults to `8`.
   *
   * You can set the `chunkSize` option to control how many documents are inserted in each network request. Defaults to `20`,
   * the Data API limit. If you have large documents, you may find it beneficial to reduce this number and increase concurrency.
   *
   * @example
   * ```typescript
   * try {
   *   await collection.insertMany([
   *     { _id: '1', name: 'John Doe' },
   *     { name: 'Jane Doe' }, // _id will be generated
   *   ], { ordered: true });
   *
   *   await collection.insertMany([
   *     { _id: '1', name: 'John Doe' },
   *     { name: 'Jane Doe' }, // _id will be generated
   *   ]);
   * } catch (e) {
   *   if (e instanceof InsertManyError) {
   *     console.log(e.insertedIds);
   *   }
   * }
   * ```
   *
   * @param documents - The documents to insert.
   * @param options - The options for the operation.
   *
   * @return InsertManyResult
   *
   * @throws InsertManyError - If the operation fails
   */
  async insertMany(documents: Schema[], options?: InsertManyOptions): Promise<InsertManyResult<Schema>> {
    const chunkSize = options?.chunkSize ?? 20;

    for (let i = 0, n = documents.length; i < n; i++) {
      setDefaultIdForInsert(documents[i]);
    }

    const insertedIds = (options?.ordered)
      ? await insertManyOrdered<Schema>(this._httpClient, documents, chunkSize)
      : await insertManyUnordered<Schema>(this._httpClient, documents, options?.parallel ?? 8, chunkSize);

    return {
      insertedCount: insertedIds.length,
      insertedIds: insertedIds,
    }
  }

  /**
   * Updates a single document in the collection.
   *
   * You can upsert a document by setting the `upsert` option to `true`.
   *
   * You can also specify a sort option to determine which document to update if multiple documents match the filter.
   *
   * @example
   * ```typescript
   * await collection.insetOne({ _id: '1', name: 'John Doe' });
   * await collection.updateOne({ _id: '1' }, { $set: { name: 'Jane Doe' } });
   * ```
   *
   * @param filter - A filter to select the document to update.
   * @param update - The update to apply to the selected document.
   * @param options - The options for the operation.
   *
   * @return UpdateOneResult
   */
  async updateOne(filter: Filter<Schema>, update: UpdateFilter<Schema>, options?: UpdateOneOptions<Schema>): Promise<UpdateOneResult> {
    const command: UpdateOneCommand = {
      updateOne: {
        filter,
        update,
        options: {
          upsert: options?.upsert,
        },
      },
    };

    if (options?.sort) {
      command.updateOne.sort = options.sort;
    }

    setDefaultIdForUpsert(command.updateOne);

    const resp = await this._httpClient.executeCommand(command, options, updateOneOptionKeys);

    const commonResult = {
      modifiedCount: resp.status?.modifiedCount,
      matchedCount: resp.status?.matchedCount,
    } as const;

    return (resp.status?.upsertedId)
      ? {
        ...commonResult,
        upsertedId: resp.status?.upsertedId,
        upsertedCount: 1,
      }
      : commonResult;
  }

  /**
   * Updates many documents in the collection.
   *
   * **NB. This function paginates the deletion of documents in chunks to avoid running into insertion limits. This
   * means multiple requests will be made to the server, and the operation may not be atomic.**
   *
   * You can upsert documents by setting the `upsert` option to `true`.
   *
   * You can also specify a sort option to determine which documents to update if multiple documents match the filter.
   *
   * @example
   * ```typescript
   * await collection.insertMany([
   *   { _id: '1', name: 'John Doe', car: 'Renault Twizy' },
   *   { car: 'BMW 330i' },
   *   { car: 'McLaren 4x4 SUV' },
   * ]);
   *
   * await collection.updateMany({
   *   name: { $exists: false }
   * }, {
   *   $set: { name: 'unknown' }
   * });
   * ```
   *
   * @remarks
   * This operation is not atomic. Depending on the amount of matching documents, it can keep running (in a blocking
   * way) for a macroscopic time. In that case, new documents that are meanwhile inserted
   * (e.g. from another process/application) may be updated during the execution of this method call.
   *
   * @param filter - A filter to select the documents to update.
   * @param update - The update to apply to the selected documents.
   * @param options - The options for the operation.
   *
   * @return UpdateManyResult
   */
  async updateMany(filter: Filter<Schema>, update: UpdateFilter<Schema>, options?: UpdateManyOptions): Promise<UpdateManyResult> {
    const command: UpdateManyCommand = {
      updateMany: {
        filter,
        update,
        options: {
          upsert: options?.upsert,
        },
      },
    };

    setDefaultIdForUpsert(command.updateMany);

    const commonResult = {
      modifiedCount: 0,
      matchedCount: 0,
    };

    let resp;

    try {
      while (!resp || resp.status?.nextPageState) {
        resp = await this._httpClient.executeCommand(command);
        command.updateMany.options.pagingState = resp.status?.nextPageState ;
        commonResult.modifiedCount += resp.status?.modifiedCount ?? 0;
        commonResult.matchedCount += resp.status?.matchedCount ?? 0;
      }
    } catch (e) {
      if (!(e instanceof DataAPIResponseError)) {
        throw e;
      }
      const desc = e.detailedErrorDescriptors[0];

      commonResult.modifiedCount += desc.rawResponse?.status?.modifiedCount ?? 0;
      commonResult.matchedCount += desc.rawResponse?.status?.matchedCount ?? 0;

      throw mkRespErrorFromResponse(UpdateManyError, command, desc.rawResponse, commonResult);
    }

    return (resp.status?.upsertedId)
      ? {
        ...commonResult,
        upsertedId: resp.status?.upsertedId,
        upsertedCount: 1,
      }
      : commonResult;
  }

  /**
   * Replaces a single document in the collection.
   *
   * You can upsert a document by setting the `upsert` option to `true`.
   *
   * @example
   * ```typescript
   * await collection.insertOne({ _id: '1', name: 'John Doe' });
   * await collection.replaceOne({ _id: '1' }, { name: 'Jane Doe' });
   * ```
   *
   * @param filter - A filter to select the document to replace.
   * @param replacement - The replacement document, which contains no `_id` field.
   * @param options - The options for the operation.
   *
   * @return ReplaceOneResult
   */
  async replaceOne(filter: Filter<Schema>, replacement: NoId<Schema>, options?: ReplaceOneOptions): Promise<ReplaceOneResult> {
    const command: FindOneAndReplaceCommand = {
      findOneAndReplace: {
        filter,
        replacement,
        options: {
          returnDocument: 'before',
          upsert: options?.upsert,
        },
      },
    };

    setDefaultIdForUpsert(command.findOneAndReplace, true);

    const resp = await this._httpClient.executeCommand(command, options, findOneAndReplaceOptionsKeys);

    const commonResult = {
      modifiedCount: resp.status?.modifiedCount,
      matchedCount: resp.status?.matchedCount,
    } as const;

    return (resp.status?.upsertedId)
      ? {
        ...commonResult,
        upsertedId: resp.status?.upsertedId,
        upsertedCount: 1,
      }
      : commonResult;
  }

  /**
   * Deletes a single document from the collection.
   *
   * You can specify a `sort` option to determine which document to delete if multiple documents match the filter.
   *
   * @example
   * ```typescript
   * await collection.insertOne({ _id: '1', name: 'John Doe' });
   * await collection.deleteOne({ _id: '1' });
   * ```
   *
   * @param filter - A filter to select the document to delete.
   * @param options - The options for the operation.
   *
   * @return DeleteOneResult
   */
  async deleteOne(filter: Filter<Schema> = {}, options?: DeleteOneOptions<Schema>): Promise<DeleteOneResult> {
    const command: DeleteOneCommand = {
      deleteOne: { filter },
    };

    if (options?.sort) {
      command.deleteOne.sort = options.sort;
    }

    const deleteOneResp = await this._httpClient.executeCommand(command, options);

    return {
      deletedCount: deleteOneResp.status?.deletedCount,
    };
  }

  /**
   * Deletes many documents from the collection.
   *
   * **NB. This function paginates the deletion of documents in chunks to avoid running into insertion limits. This
   * means multiple requests will be made to the server, and the operation may not be atomic.**
   *
   * If an empty filter is passed, an error will be thrown, asking you to use {@link deleteAll} instead for your safety.
   *
   * @example
   * ```typescript
   * await collection.insertMany([
   *   { _id: '1', name: 'John Doe' },
   *   { name: 'Jane Doe' },
   * ]);
   *
   * await collection.deleteMany({ name: 'John Doe' });
   * ```
   *
   * @remarks
   * This operation is not atomic. Depending on the amount of matching documents, it can keep running (in a blocking
   * way) for a macroscopic time. In that case, new documents that are meanwhile inserted
   * (e.g. from another process/application) will be deleted during the execution of this method call.
   *
   * @param filter - A filter to select the documents to delete.
   *
   * @return DeleteManyResult
   *
   * @throws Error - If an empty filter is passed.
   */
  async deleteMany(filter: Filter<Schema> = {}): Promise<DeleteManyResult> {
    if (Object.keys(filter).length === 0) {
      throw new Error('Can\'t pass an empty filter to deleteMany, use deleteAll instead if you really want to delete everything');
    }

    const command: DeleteManyCommand = {
      deleteMany: { filter },
    };

    let resp;
    let numDeleted = 0;

    try {
      while (!resp || resp.status?.moreData) {
        resp = await this._httpClient.executeCommand(command);
        numDeleted += resp.status?.deletedCount ?? 0;
      }
    } catch (e) {
      if (!(e instanceof DataAPIResponseError)) {
        throw e;
      }
      const desc = e.detailedErrorDescriptors[0];
      throw mkRespErrorFromResponse(DeleteManyError, command, desc.rawResponse, { deletedCount: numDeleted + (desc.rawResponse?.status?.deletedCount ?? 0) })
    }

    return {
      deletedCount: numDeleted,
    };
  }


  /**
   * Deletes all documents from the collection. **Use with caution.**
   *
   * Unlike {@link deleteMany}, this method is atomic and will delete all documents in the collection in one go,
   * without making multiple network requests to the server.
   */
  async deleteAll(): Promise<void> {
    const command: DeleteManyCommand = {
      deleteMany: { filter: {} },
    };

    await this._httpClient.executeCommand(command);
  }

  /**
   * Find documents on the collection, optionally matching the provided filter.
   *
   * Also accepts `sort`, `limit`, `skip`, `includeSimilarity`, and `projection` options.
   *
   * The method returns a {@link FindCursor} that can then be iterated over.
   *
   * **NB. If a *non-vector-sort* `sort` option is provided, the iteration of all documents may not be atomic—it will
   * iterate over cursors in an approximate way, exhibiting occasional skipped or duplicate documents, with real-time
   * collection mutations being displayed**
   *
   * @param filter - A filter to select the documents to find. If not provided, all documents will be returned.
   * @param options - The options for the operation.
   *
   * @return FindCursor
   */
  find<GetSim extends boolean = false>(filter: Filter<Schema>, options?: FindOptions<Schema, GetSim>): FindCursor<FoundDoc<Schema, GetSim>, FoundDoc<Schema, GetSim>> {
    return new FindCursor(this.namespace, this._httpClient, filter, options) as any;
  }

  async distinct<Key extends string, GetSim extends boolean = false>(key: Key, filter: Filter<Schema> = {}, _?: FindOptions<Schema, GetSim>): Promise<Flatten<(SomeDoc & ToDotNotation<FoundDoc<Schema, GetSim>>)[Key]>[]> {
    assertPathSafe4Distinct(key);

    const projection = pullSafeProjection4Distinct(key);
    const cursor = this.find<GetSim>(filter, { projection: { _id: 0, [projection]: 1 } });

    const seen = new Set<unknown>();
    const ret = [];

    const extract = mkDistinctPathExtractor(key);

    for await (const doc of cursor) {
      const values = extract(doc);

      for (let i = 0, n = values.length; i < n; i++) {
        if (typeof values[i] === 'object') {
          const hash = objectHash(values[i]);

          if (!seen.has(hash)) {
            seen.add(hash);
            ret.push(values[i]);
          }
        } else {
          if (!seen.has(values[i])) {
            seen.add(values[i]);
            ret.push(values[i]);
          }
        }
      }
    }

    return ret;
  }

  /**
   * Finds a single document in the collection.
   *
   * You can specify a `sort` option to determine which document to find if multiple documents match the filter.
   *
   * You can also specify a `projection` option to determine which fields to include in the returned document.
   *
   * If sorting by `$vector`, you can set the `includeSimilarity` option to `true` to include the similarity score in the
   * returned document as `$similarity: number`.
   *
   * @example
   * ```typescript
   * const doc = await collection.findOne({}, {
   *   sort: {
   *     $vector: [.12, .52, .32],
   *   },
   *   includeSimilarity: true,
   * });
   *
   * console.log(doc?.$similarity);
   * ```
   *
   * @remarks
   * If you really need `limit` or `skip`, prefer using the {@link find} method instead.
   *
   * @param filter - A filter to select the document to find.
   * @param options - The options for the operation.
   *
   * @return The found document, or `null` if no document was found.
   */
  async findOne<GetSim extends boolean = false>(filter: Filter<Schema>, options?: FindOneOptions<Schema, GetSim>): Promise<FoundDoc<Schema, GetSim> | null> {
    const command: FindOneCommand = {
      findOne: {
        filter,
        options: {
          includeSimilarity: options?.includeSimilarity,
        }
      },
    };

    if (options?.sort) {
      command.findOne.sort = options.sort;
    }

    if (options?.projection && Object.keys(options.projection).length > 0) {
      command.findOne.projection = options.projection;
    }

    const resp = await this._httpClient.executeCommand(command, options, findOneOptionsKeys);
    return resp.data?.document;
  }

  /**
   * Atomically finds a single document in the collection and replaces it.
   *
   * Set `returnDocument` to `'after'` to return the document as it is after the replacement, or `'before'` to return the
   * document as it was before the replacement.
   *
   * You can specify a `sort` option to determine which document to find if multiple documents match the filter.
   *
   * You can also set `projection` to determine which fields to include in the returned document.
   *
   * You can also set `upsert` to `true` to insert a new document if no document matches the filter.
   *
   * @example
   * ```typescript
   * const doc = await collection.findOneAndReplace(
   *   { _id: '1' },
   *   { _id: '1', name: 'John Doe' },
   *   { returnDocument: 'after' }
   * );
   *
   * // Prints { _id: '1', name: 'John Doe' }
   * console.log(doc);
   * ```
   *
   * @param filter - A filter to select the document to find.
   * @param replacement - The replacement document, which contains no `_id` field.
   * @param options - The options for the operation.
   *
   * @return ModifyResult
   */
  async findOneAndReplace(
    filter: Filter<Schema>,
    replacement: NoId<Schema>,
    options: FindOneAndReplaceOptions<Schema> & { includeResultMetadata: true },
  ): Promise<ModifyResult<Schema>>

  async findOneAndReplace(
    filter: Filter<Schema>,
    replacement: NoId<Schema>,
    options: FindOneAndReplaceOptions<Schema> & { includeResultMetadata?: false },
  ): Promise<WithId<Schema> | null>

  async findOneAndReplace(filter: Filter<Schema>, replacement: NoId<Schema>, options: FindOneAndReplaceOptions<Schema>): Promise<ModifyResult<Schema> | WithId<Schema> | null> {
    const command: FindOneAndReplaceCommand = {
      findOneAndReplace: {
        filter,
        replacement,
        options: {
          returnDocument: options.returnDocument,
          upsert: options.upsert,
        },
      },
    };

    setDefaultIdForUpsert(command.findOneAndReplace, true);

    if (options?.sort) {
      command.findOneAndReplace.sort = options.sort;
    }

    if (options?.projection && Object.keys(options.projection).length > 0) {
      command.findOneAndReplace.projection = options.projection;
    }

    const resp = await this._httpClient.executeCommand(command, options, findOneAndReplaceOptionsKeys);

    return (options.includeResultMetadata)
      ? {
        value: resp.data?.document,
        ok: 1,
      }
      : resp.data?.document;
  }

  /**
   * Counts the number of documents in the collection, optionally with a filter.
   *
   * Takes in a `limit` option which dictates the maximum number of documents that may be present before a
   * {@link TooManyDocsToCountError} is thrown. If the limit is higher than the highest limit accepted by the
   * Data API, a {@link TooManyDocsToCountError} will be thrown anyway (i.e. `1000`).
   *
   * @example
   * ```typescript
   * await collection.insertMany([
   *   { _id: '1', name: 'John Doe' },
   *   { name: 'Jane Doe' },
   * ]);
   *
   * const count = await collection.countDocuments({ name: 'John Doe' }, 1000);
   * console.log(count); // 1
   *
   * // Will throw a TooManyDocsToCountError as it counts 1, but the limit is 0
   * const count = await collection.countDocuments({ name: 'John Doe' }, 0);
   * ```
   *
   * @remarks
   * Count operations are expensive: for this reason, the best practice is to provide a reasonable `upperBound`
   * according to the caller expectations. Moreover, indiscriminate usage of count operations for sizeable amounts
   * of documents (i.e. in the thousands and more) is discouraged in favor of alternative application-specific
   * solutions. Keep in mind that the Data API has a hard upper limit on the amount of documents it will count,
   * and that an exception will be thrown by this method if this limit is encountered.
   *
   * @param filter - A filter to select the documents to count. If not provided, all documents will be counted.
   * @param upperBound - The maximum number of documents to count.
   * @param options - The options for the operation.
   *
   * @throws TooManyDocsToCountError - If the number of documents counted exceeds the provided limit.
   */
  async countDocuments(filter: Filter<Schema>, upperBound: number, options?: BaseOptions): Promise<number> {
    const command = {
      countDocuments: { filter },
    };

    if (!upperBound) {
      throw new Error('options.limit is required');
    }

    const resp = await this._httpClient.executeCommand(command, options);

    if (resp.status?.count > upperBound) {
      throw new TooManyDocsToCountError(upperBound, false);
    }

    if (resp.status?.moreData) {
      throw new TooManyDocsToCountError(resp.status.count, true);
    }

    return resp.status?.count;
  }

  /**
   * Atomically finds a single document in the collection and deletes it.
   *
   * You can specify a `sort` option to determine which document to find if multiple documents match the filter.
   *
   * You can also set `projection` to determine which fields to include in the returned document.
   *
   * @example
   * ```typescript
   * await collection.insertOne({ _id: '1', name: 'John Doe' });
   * const doc = await collection.findOneAndDelete({ _id: '1' });
   * console.log(doc); // The deleted document
   * ```
   *
   * @param filter - A filter to select the document to find.
   * @param options - The options for the operation.
   *
   * @return
   *  if `includeResultMetadata` is `true`, a `ModifyResult` object with the deleted document and the `ok` status.
   *  Otherwise, the deleted document, or `null` if no document was found.
   */
  async findOneAndDelete(
    filter: Filter<Schema>,
    options?: FindOneAndDeleteOptions<Schema> & { includeResultMetadata: true },
  ): Promise<ModifyResult<Schema>>

  async findOneAndDelete(
    filter: Filter<Schema>,
    options?: FindOneAndDeleteOptions<Schema> & { includeResultMetadata?: false },
  ): Promise<WithId<Schema> | null>

  async findOneAndDelete(filter: Filter<Schema>, options?: FindOneAndDeleteOptions<Schema>): Promise<ModifyResult<Schema> | WithId<Schema> | null> {
    const command: FindOneAndDeleteCommand = {
      findOneAndDelete: { filter },
    };

    if (options?.sort) {
      command.findOneAndDelete.sort = options.sort;
    }

    if (options?.projection && Object.keys(options.projection).length > 0) {
      command.findOneAndDelete.projection = options.projection;
    }

    const resp = await this._httpClient.executeCommand(command, options);

    return (options?.includeResultMetadata)
      ? {
        value: resp.data?.document,
        ok: 1,
      }
      : resp.data?.document;
  }

  /**
   * Finds a single document in the collection and updates it.
   *
   * Set `returnDocument` to `'after'` to return the document as it is after the update, or `'before'` to return the
   * document as it was before the update.
   *
   * You can specify a `sort` option to determine which document to find if multiple documents match the filter.
   *
   * You can also set `upsert` to `true` to insert a new document if no document matches the filter.
   *
   * @example
   * ```typescript
   * const doc = await collection.findOneAndUpdate(
   *   { _id: '1' },
   *   { $set: { name: 'Jane Doe' } },
   *   { returnDocument: 'after' }
   * );
   *
   * // Prints { _id: '1', name: 'Jane Doe' }
   * console.log(doc);
   * ```
   *
   * @param filter - A filter to select the document to find.
   * @param update - The update to apply to the selected document.
   * @param options - The options for the operation.
   */
  async findOneAndUpdate(
    filter: Filter<Schema>,
    update: UpdateFilter<Schema>,
    options: FindOneAndUpdateOptions<Schema> & { includeResultMetadata: true },
  ): Promise<ModifyResult<Schema>>

  async findOneAndUpdate(
    filter: Filter<Schema>,
    update: UpdateFilter<Schema>,
    options: FindOneAndUpdateOptions<Schema> & { includeResultMetadata?: false },
  ): Promise<WithId<Schema> | null>

  async findOneAndUpdate(filter: Filter<Schema>, update: UpdateFilter<Schema>, options: FindOneAndUpdateOptions<Schema>): Promise<ModifyResult<Schema> | WithId<Schema> | null> {
    const command: FindOneAndUpdateCommand = {
      findOneAndUpdate: {
        filter,
        update,
        options: {
          returnDocument: options.returnDocument,
          upsert: options.upsert,
        },
      },
    };

    setDefaultIdForUpsert(command.findOneAndUpdate);

    if (options?.sort) {
      command.findOneAndUpdate.sort = options.sort;
    }

    if (options?.projection && Object.keys(options.projection).length > 0) {
      command.findOneAndUpdate.projection = options.projection;
    }

    const resp = await this._httpClient.executeCommand(command, options, findOneAndUpdateOptionsKeys);

    return (options.includeResultMetadata)
      ? {
        value: resp.data?.document,
        ok: 1,
      }
      : resp.data?.document;
  }

  /**
   * Execute arbitrary operations sequentially/concurrently on the collection, such as insertions, updates, replaces,
   * & deletions, **non-atomically**
   *
   * Each operation is treated as a separate, unrelated request to the server; it is not performed in a transaction.
   *
   * You can set the `ordered` option to `true` to stop the operations after the first error, otherwise all operations
   * may be parallelized and processed in arbitrary order, improving, perhaps vastly, performance.
   *
   * *Note that the bulkWrite being ordered has nothing to do with if the operations themselves are ordered or not.*
   *
   * If an operational error occurs, the operation will throw a {@link BulkWriteError} containing the partial result.
   *
   * *If the exception is not due to a soft `2XX` error, e.g. a `5xx` error or network error, the operation will throw
   * the underlying error.*
   *
   * *In case of an unordered request, if the error was a simple operational error, a `BulkWriteError` will be thrown
   * after every operation has been attempted. If it was a `5xx` or similar, the error will be thrown immediately.*
   *
   * You can set the `parallel` option to control how many network requests are made in parallel on unordered
   * insertions. Defaults to `8`.
   *
   * @example
   * ```typescript
   * try {
   *   // Insert a document, then delete it
   *   await collection.bulkWrite([
   *     { insertOne: { document: { _id: '1', name: 'John Doe' } } },
   *     { deleteOne: { filter: { name: 'John Doe' } } },
   *   ]);
   *
   *   // Insert and delete operations, will cause a data race
   *   await collection.bulkWrite([
   *     { insertOne: { document: { _id: '1', name: 'John Doe' } } },
   *     { deleteOne: { filter: { name: 'John Doe' } } },
   *   ]);
   * } catch (e) {
   *   if (e instanceof BulkWriteError) {
   *     console.log(e.insertedCount);
   *     console.log(e.deletedCount);
   *   }
   * }
   * ```
   *
   * @param operations
   * @param options
   *
   * @return BulkWriteResult
   *
   * @throws BulkWriteError - If the operation fails
   */
  async bulkWrite(operations: AnyBulkWriteOperation<Schema>[], options?: BulkWriteOptions): Promise<BulkWriteResult> {
    const commands = operations.map(buildBulkWriteCommands);

    return (options?.ordered)
      ? await bulkWriteOrdered(this._httpClient, commands)
      : await bulkWriteUnordered(this._httpClient, commands, options?.parallel ?? 8);
  }

  /**
   * Get the collection options, i.e. its configuration as read from the database.
   *
   *  The method issues a request to the Data API each time is invoked,
   *         without caching mechanisms: this ensures up-to-date information
   *         for usages such as real-time collection validation by the application.
   *
   * @return The options that the collection was created with (i.e. the `vector` and `indexing` operations).
   */
  async options(): Promise<CollectionOptions<SomeDoc>> {
    const results = await this._db.listCollections({ nameOnly: false });

    const collection = results.find((c) => c.name === this._collectionName);

    if (!collection) {
      throw new Error(`Collection ${this._collectionName} not found`);
    }

    return collection.options ?? {};
  }

  /**
   * Drops the collection from the database, including all the documents it contains.
   *
   * @example
   * ```typescript
   * const collection = await db.createCollection('my_collection');
   * await collection.drop();
   * ```
   *
   * @param options - The options for the operation.
   *
   * @return `true` if the collection was dropped okay.
   */
  async drop(options?: BaseOptions): Promise<boolean> {
    return await this._db.dropCollection(this._collectionName, options);
  }
}

// -- Insert Many ------------------------------------------------------------------------------------------

const insertManyOrdered = async <Schema>(httpClient: HTTPClient, documents: unknown[], chunkSize: number): Promise<IdOf<Schema>[]> => {
  const insertedIds: IdOf<Schema>[] = [];

  for (let i = 0, n = documents.length; i < n; i += chunkSize) {
    const slice = documents.slice(i, i + chunkSize);

    try {
      const inserted = await insertMany<Schema>(httpClient, slice, true);
      insertedIds.push(...inserted);
    } catch (e) {
      if (!(e instanceof DataAPIResponseError)) {
        throw e;
      }
      const desc = e.detailedErrorDescriptors[0];

      insertedIds.push(...desc.rawResponse.status?.insertedIds ?? []);
      throw mkRespErrorFromResponse(InsertManyError, desc.command, desc.rawResponse, { insertedIds: insertedIds, insertedCount: insertedIds.length })
    }
  }

  return insertedIds;
}

const insertManyUnordered = async <Schema>(httpClient: HTTPClient, documents: unknown[], parallel: number, chunkSize: number): Promise<IdOf<Schema>[]> => {
  const insertedIds: IdOf<Schema>[] = [];
  let masterIndex = 0;

  const failCommands = [] as Record<string, any>[];
  const failRaw = [] as Record<string, any>[];

  const workers = Array.from({ length: parallel }, async () => {
    while (masterIndex < documents.length) {
      const localI = masterIndex;
      const endIdx = Math.min(localI + chunkSize, documents.length);
      masterIndex += chunkSize;

      if (localI >= endIdx) {
        break;
      }

      const slice = documents.slice(localI, endIdx);

      try {
        const inserted = await insertMany<Schema>(httpClient, slice, false);
        insertedIds.push(...inserted);
      } catch (e) {
        if (!(e instanceof DataAPIResponseError)) {
          throw e;
        }
        const desc = e.detailedErrorDescriptors[0];

        const justInserted = desc.rawResponse.status?.insertedIds ?? [];
        insertedIds.push(...justInserted);

        failCommands.push(desc.command);
        failRaw.push(desc.rawResponse);
      }
    }
  });
  await Promise.all(workers);

  if (failCommands.length > 0) {
    throw mkRespErrorFromResponses(InsertManyError, failCommands, failRaw, { insertedIds: insertedIds, insertedCount: insertedIds.length });
  }

  return insertedIds;
}

const insertMany = async <Schema>(httpClient: HTTPClient, documents: unknown[], ordered: boolean): Promise<IdOf<Schema>[]> => {
  const command: InsertManyCommand = {
    insertMany: {
      documents,
      options: { ordered },
    }
  }

  const resp = await httpClient.executeCommand(command, {}, insertManyOptionKeys);
  return resp.status?.insertedIds ?? [];
}

// -- Bulk Write ------------------------------------------------------------------------------------------

const bulkWriteOrdered = async (httpClient: HTTPClient, operations: Record<string, any>[]): Promise<BulkWriteResult> => {
  const results = new BulkWriteResult();
  let i = 0;

  try {
    for (let n = operations.length; i < n; i++) {
      const resp = await httpClient.executeCommand(operations[i], {});
      addToBulkWriteResult(results, resp.status!, i);
    }
  } catch (e) {
    if (!(e instanceof DataAPIResponseError)) {
      throw e;
    }
    const desc = e.detailedErrorDescriptors[0];

    if (desc.rawResponse.status) {
      addToBulkWriteResult(results, desc.rawResponse.status, i)
    }

    throw mkRespErrorFromResponse(BulkWriteError, desc.command, desc.rawResponse, results);
  }

  return results;
}

const bulkWriteUnordered = async (httpClient: HTTPClient, operations: Record<string, any>[], parallel: number): Promise<BulkWriteResult> => {
  const results = new BulkWriteResult();
  let masterIndex = 0;

  const failCommands = [] as Record<string, any>[];
  const failRaw = [] as Record<string, any>[];

  const workers = Array.from({ length: parallel }, async () => {
    while (masterIndex < operations.length) {
      const localI = masterIndex;
      masterIndex++;

      if (localI >= operations.length) {
        break;
      }

      const command = operations[localI];

      try {
        const resp = await httpClient.executeCommand(command, {});
        addToBulkWriteResult(results, resp.status!, localI);
      } catch (e) {
        if (!(e instanceof DataAPIResponseError)) {
          throw e;
        }
        const desc = e.detailedErrorDescriptors[0];

        if (desc.rawResponse.status) {
          addToBulkWriteResult(results, desc.rawResponse.status, localI);
        }

        failCommands.push(desc.command);
        failRaw.push(desc.rawResponse);
      }
    }
  });
  await Promise.all(workers);

  if (failCommands.length > 0) {
    throw mkRespErrorFromResponses(BulkWriteError, failCommands, failRaw, results);
  }

  return results;
}

const buildBulkWriteCommands = (operations: Record<string, any>): Record<string, any> => {
  const commandName = Object.keys(operations)[0];
  switch (commandName) {
    case 'insertOne': return { insertOne: { document: operations.insertOne.document } };
    case 'updateOne': return { updateOne: { filter: operations.updateOne.filter, update: operations.updateOne.update, options: { upsert: operations.updateOne.upsert ?? false } } };
    case 'updateMany': return { updateMany: { filter: operations.updateMany.filter, update: operations.updateMany.update, options: { upsert: operations.updateMany.upsert ?? false } } };
    case 'replaceOne': return { findOneAndReplace: { filter: operations.replaceOne.filter, replacement: operations.replaceOne.replacement, options: { upsert: operations.replaceOne.upsert ?? false } } };
    case 'deleteOne': return { deleteOne: { filter: operations.deleteOne.filter } };
    case 'deleteMany': return { deleteMany: { filter: operations.deleteMany.filter } };
    default: throw new Error(`Unknown bulk write operation: ${commandName}`);
  }
}

type MutableBulkWriteResult = {
  -readonly [K in keyof BulkWriteResult]: BulkWriteResult[K];
}

const addToBulkWriteResult = (result: BulkWriteResult, resp: Record<string, any>, i: number) => {
  const asMutable = result as MutableBulkWriteResult;

  asMutable.insertedCount += resp.insertedIds?.length ?? 0;
  asMutable.modifiedCount += resp.modifiedCount ?? 0;
  asMutable.matchedCount += resp.matchedCount ?? 0;
  asMutable.deletedCount += resp.deletedCount ?? 0;

  if (resp.upsertedId) {
    asMutable.upsertedCount++;
    asMutable.upsertedIds[i] = resp.upsertedId;
  }

  asMutable.getRawResponse().push(resp);
}

// -- Distinct --------------------------------------------------------------------------------------------

const assertPathSafe4Distinct = (path: string): void => {
  const split = path.split('.');

  if (split.length === 0) {
    throw new Error('Path cannot be empty');
  }

  if (split.some(p => !p)) {
    throw new Error('Path cannot contain empty segments');
  }
}

const pullSafeProjection4Distinct = (path: string): string => {
  return takeWhile(path.split('.'), p => isNaN(p as any)).join('.');
}

const mkDistinctPathExtractor = (path: string): (doc: SomeDoc) => any[] => {
  const values = [] as any[];

  const extract = (path: string[], index: number, value: any) => {
    if (!value) {
      return;
    }

    if (index === path.length) {
      if (Array.isArray(value)) {
        values.push(...value);
      } else {
        values.push(value);
      }
      return;
    }

    const prop = path[index];

    if (Array.isArray(value)) {
      const asInt = parseInt(prop, 10);

      if (isNaN(asInt)) {
        for (let i = 0, n = value.length; i < n; i++) {
          extract(path, index, value[i]);
        }
      } else if (asInt < value.length) {
        extract(path, index + 1, value[asInt]);
      }
    } else if (value && typeof value === 'object') {
      extract(path, index + 1, value[prop]);
    }
  }

  return (doc: SomeDoc) => {
    extract(path.split('.'), 0, doc);
    return values;
  };
}
