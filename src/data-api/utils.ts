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

declare const __error: unique symbol;

/**
 * Represents some type-level error which forces immediate attention rather than failing @ runtime.
 * 
 * More inflexable type than `never`, and gives contextual error messages.
 * 
 * @example
 * ```
 * function unsupported(): TypeErr<'Unsupported operation'> {
 *   throw new Error('Unsupported operation');
 * }
 * 
 * // Doesn't compile with error:
 * // Type { [__error]: 'Unsupported operation' } is not assignable to type string
 * const result: string = unsupported();
 * ```
 */
export type TypeErr<S> = unknown & { [__error]: S };

/**
 * @internal
 */
export function takeWhile<T>(arr: T[], pred: (x: T) => boolean): T[] {
  const result: T[] = [];

  for (let i = 0, n = arr.length; i < n && pred(arr[i]); i++) {
    result.push(arr[i]);
  }

  return result;
}

/**
 * @internal
 */
export function extractDbIdFromUrl(uri: string): string | undefined {
  return new URL(uri).hostname.match(/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}/)?.[0];
}

/**
 * @internal
 */
export function replaceAstraUrlIdAndRegion(uri: string, id: string, region: string): string {
  const url = new URL(uri);
  const parts = url.hostname.split('.');
  parts[0] = id + '-' + region;
  url.hostname = parts.join('.');
  return url.toString().slice(0, -1);
}
