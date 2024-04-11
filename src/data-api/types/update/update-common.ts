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

import type { IdOf } from '@/src/data-api/types';
import { SomeDoc } from '@/src/data-api';

/**
 * Represents the set of fields that are guaranteed to be present in the result of an update operation.
 *
 * @field matchedCount - The number of documents that matched the filter.
 * @field modifiedCount - The number of documents that were actually modified.
 *
 * @public
 */
export interface GuaranteedUpdateOptions<N extends number> {
  /**
   * The number of documents that matched the filter.
   */
  matchedCount: N,
  /**
   * The number of documents that were actually modified.
   */
  modifiedCount: N,
}

/**
 * Represents the set of fields that are present in the result of an update operation when the `upsert` option is true,
 * and an upsert occurred.
 *
 * @field upsertedId - The identifier of the upserted document.
 * @field upsertedCount - The number of documents that were upserted.
 *
 * @public
 */
export interface UpsertedUpdateOptions<Schema extends SomeDoc> {
  /**
   * The identifier of the upserted document (this will be an autogenerated ID if one was not provided).
   */
  upsertedId: IdOf<Schema>;
  /**
   * The number of documents that were upserted.
   */
  upsertedCount: 1;
}

/**
 * Represents the set of fields that are present in the result of an update operation where no upsert occurred.
 *
 * @field upsertedCount - The number of documents that were upserted.
 * @field upsertedId - This field is never present.
 *
 * @public
 */
export interface NoUpsertUpdateOptions {
  /**
   * The number of documents that were upserted. This will always be undefined, since none occurred.
   */
  upsertedCount: 0;
  /**
   * This field is never present.
   */
  upsertedId?: never;
}

/**
 * Represents the result of an update operation.
 *
 * @example
 * ```typescript
 * const result = await collection.updateOne({
 *   _id: 'abc'
 * }, {
 *   $set: { name: 'John' }
 * }, {
 *   upsert: true
 * });
 *
 * if (result.upsertedCount) {
 *   console.log(`Document with ID ${result.upsertedId} was upserted`);
 * }
 * ```
 *
 * @field matchedCount - The number of documents that matched the filter.
 * @field modifiedCount - The number of documents that were actually modified.
 * @field upsertedCount - The number of documents that were upserted.
 * @field upsertedId - The identifier of the upserted document if `upsertedCount > 0`.
 *
 * @public
 */
export type InternalUpdateResult<Schema extends SomeDoc, N extends number> =
  | (GuaranteedUpdateOptions<N> & UpsertedUpdateOptions<Schema>)
  | (GuaranteedUpdateOptions<N> & NoUpsertUpdateOptions)
