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

import type { IdOf, BaseOptions } from '@/src/data-api/types';

/** @internal */
export interface InsertOneCommand {
  insertOne: {
    document: object,
  }
}

export interface InsertOneOptions extends BaseOptions {
  vector?: number[],
}

/**
 * Represents the result of an insertOne command.
 *
 * @field insertedId - The ID of the inserted document.
 */
export interface InsertOneResult<Schema> {
  /**
   * The ID of the inserted document (this will be an autogenerated ID if one was not provided).
   */
  insertedId: IdOf<Schema>,
}
