import { AdminBlockingOptions, FullDatabaseInfo } from '@/src/devops/types';
import { DEFAULT_DEVOPS_API_ENDPOINT, DevopsApiHttpClient, HTTP_METHODS, HttpClient } from '@/src/api';
import { Db } from '@/src/data-api';
import { AdminSpawnOptions, RootClientOptsWithToken } from '@/src/client';
import { DbAdmin } from '@/src/devops/db-admin';

/**
 * An administrative class for managing Astra databases, including creating, listing, and deleting databases.
 *
 * **Shouldn't be instantiated directly; use {@link DataApiClient.admin} to obtain an instance of this class.**
 *
 * To perform admin tasks on a per-database basis, see the {@link AstraDbAdmin} class.
 *
 * @example
 * ```typescript
 * const client = new DataApiClient('token');
 *
 * // Create an admin instance with the default token
 * const admin1 = client.admin();
 *
 * // Create an admin instance with a custom token
 * const admin2 = client.admin({ adminToken: 'stronger-token' });
 *
 * const dbs = await admin1.listDatabases();
 * console.log(dbs);
 * ```
 *
 * @see DataApiClient.admin
 * @see AstraDbAdmin
 */
export class AstraDbAdmin extends DbAdmin {
  private readonly _httpClient!: DevopsApiHttpClient;
  private readonly _db!: Db;

  /**
   * Use {@link Db.admin} or {@link AstraAdmin.dbAdmin} to obtain an instance of this class.
   *
   * @internal
   */
  constructor(_db: Db, httpClient: HttpClient, options: AdminSpawnOptions) {
    super();

    Object.defineProperty(this, '_httpClient', {
      value: httpClient.cloneInto(DevopsApiHttpClient, (c) => {
        c.baseUrl = options.endpointUrl ?? DEFAULT_DEVOPS_API_ENDPOINT;
      }),
      enumerable: false,
    });

    Object.defineProperty(this, '_db', {
      value: _db,
      enumerable: false,
    });

    if (options.adminToken) {
      this._httpClient.applicationToken = options.adminToken;
    }
  }

  /**
   * Gets the ID of the Astra DB instance this object is managing.
   *
   * @returns the ID of the Astra DB instance.
   */
  public get id(): string {
    return this._db.id;
  }

  /**
   * Gets the underlying `Db` object. The options for the db were set when the AstraDbAdmin instance, or whatever
   * spawned it, was created.
   *
   * @example
   * ```typescript
   * const dbAdmin = client.admin().dbAdmin('<endpoint>', {
   *   namespace: 'my-namespace',
   *   useHttp2: false,
   * });
   *
   * const db = dbAdmin.db();
   * console.log(db.id);
   * ```
   *
   * @returns the underlying `Db` object.
   */
  public override db(): Db {
    return this._db;
  }

  /**
   * Fetches the complete information about the database, such as the database name, IDs, region, status, actions, and
   * other metadata.
   *
   * The method issues a request to the DevOps API each time it is invoked, without caching mechanisms;
   * this ensures up-to-date information for usages such as real-time collection validation by the application.
   *
   *
   * @example
   * ```typescript
   * const info = await dbAdmin.info();
   * console.log(info.info.name, info.creationTime);
   * ```
   *
   * @returns A promise that resolves to the complete database information.
   */
  public async info(): Promise<FullDatabaseInfo> {
    const resp = await this._httpClient.request({
      method: HTTP_METHODS.Get,
      path: `/databases/${this._db.id}`,
    });
    return resp.data;
  }

  /**
   * Lists the namespaces in the database.
   *
   * The first element in the returned array is the default namespace of the database, and the rest are additional
   * namespaces in no particular order.
   *
   * @example
   * ```typescript
   * const namespaces = await dbAdmin.listNamespaces();
   *
   * // ['default_keyspace', 'my_other_keyspace']
   * console.log(namespaces);
   * ```
   *
   * @returns A promise that resolves to an array of namespace names.
   */
  public override async listNamespaces(): Promise<string[]> {
    return this.info().then(i => [i.info.keyspace!, ...i.info.additionalKeyspaces ?? []].filter(Boolean))
  }

  /**
   * Creates a new, additional, namespace (aka keyspace) for this database.
   *
   * **NB. this is a "long-running" operation. See {@link AdminBlockingOptions} about such blocking operations.** The
   * default polling interval is 2 seconds. Expect it to take roughly 8-10 seconds to complete.
   *
   * @example
   * ```typescript
   * await dbAdmin.createNamespace('my_other_keyspace1');
   *
   * // ['default_keyspace', 'my_other_keyspace1']
   * console.log(await dbAdmin.listNamespaces());
   *
   * await dbAdmin.createNamespace('my_other_keyspace2', {
   *   blocking: false,
   * });
   *
   * // Will not include 'my_other_keyspace2' until the operation completes
   * console.log(await dbAdmin.listNamespaces());
   * ```
   *
   * @remarks
   * Note that if you choose not to block, the created namespace object will not be able to be used until the
   * operation completes, which is up to the caller to determine.
   *
   * @param namespace - The name of the new namespace.
   * @param options - The options for the blocking behavior of the operation.
   *
   * @returns A promise that resolves when the operation completes.
   */
  public override async createNamespace(namespace: string, options?: AdminBlockingOptions): Promise<void> {
    await this._httpClient.request({
      method: HTTP_METHODS.Post,
      path: `/databases/${this._db.id}/keyspaces/${namespace}`,
    });
    await this._httpClient.awaitStatus(this._db, 'ACTIVE', ['MAINTENANCE'], options, 1000);
  }

  /**
   * Drops a namespace (aka keyspace) from this database.
   *
   * **NB. this is a "long-running" operation. See {@link AdminBlockingOptions} about such blocking operations.** The
   * default polling interval is 2 seconds. Expect it to take roughly 8-10 seconds to complete.
   *
   * @example
   * ```typescript
   * await dbAdmin.dropNamespace('my_other_keyspace1');
   *
   * // ['default_keyspace', 'my_other_keyspace2']
   * console.log(await dbAdmin.listNamespaces());
   *
   * await dbAdmin.dropNamespace('my_other_keyspace2', {
   *   blocking: false,
   * });
   *
   * // Will still include 'my_other_keyspace2' until the operation completes
   * // ['default_keyspace', 'my_other_keyspace2']
   * console.log(await dbAdmin.listNamespaces());
   * ```
   *
   * @remarks
   * Note that if you choose not to block, the namespace object will still be able to be used until the operation
   * completes, which is up to the caller to determine.
   *
   * @param namespace - The name of the namespace to drop.
   * @param options - The options for the blocking behavior of the operation.
   *
   * @returns A promise that resolves when the operation completes.
   */
  public override async dropNamespace(namespace: string, options?: AdminBlockingOptions): Promise<void> {
    await this._httpClient.request({
      method: HTTP_METHODS.Delete,
      path: `/databases/${this._db.id}/keyspaces/${namespace}`,
    });
    await this._httpClient.awaitStatus(this._db, 'ACTIVE', ['MAINTENANCE'], options, 1000);
  }

  /**
   * Drops the database.
   *
   * **NB. this is a long-running operation. See {@link AdminBlockingOptions} about such blocking operations.** The
   * default polling interval is 10 seconds. Expect it to take roughly 6-7 min to complete.
   *
   * The database info will still be accessible by ID, or by using the {@link listDatabases} method with the filter
   * set to `'ALL'` or `'TERMINATED'`. However, all of its data will very much be lost.
   *
   * @example
   * ```typescript
   * const db = client.db('https://<db_id>-<region>.apps.astra.datastax.com');
   * await db.admin().drop();
   * ```
   *
   * @param options - The options for the blocking behavior of the operation.
   *
   * @returns A promise that resolves when the operation completes.
   *
   * @remarks Use with caution. Use a surge protector. Don't say I didn't warn you.
   */
  public async drop(options?: AdminBlockingOptions): Promise<void> {
    await this._httpClient.request({
      method: HTTP_METHODS.Post,
      path: `/databases/${this._db.id}/terminate`,
    });
    await this._httpClient.awaitStatus(this._db, 'TERMINATED', ['TERMINATING'], options, 10000);
  }
}

/**
 * @internal
 */
export function mkDbAdmin(db: Db, httpClient: HttpClient, rootOpts: RootClientOptsWithToken, options?: AdminSpawnOptions): AstraDbAdmin {
  return new AstraDbAdmin(db, httpClient, {
    ...rootOpts.adminOptions,
    ...options,
  });
}
