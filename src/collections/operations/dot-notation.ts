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

import { AnyDict } from '@/src/collections/collection';

export type DotNotation<Schema extends AnyDict> = Merge<_ToDotNotation<Required<Schema>, ''>>

type _ToDotNotation<Elem extends AnyDict, Prefix extends string> = {
  [Key in keyof Elem]:
    AnyDict extends Elem
      ? (
        | (Prefix extends '' ? never : { [Path in CropTrailingDot<Prefix>]: AnyDict })
        | { [Path in `${Prefix}${string}`]: any }
        ) :
    Elem[Key] extends any[]
      ? { [Path in `${Prefix}${Key & string}`]: Elem[Key] } :
    Elem[Key] extends AnyDict
      ? (
        | { [Path in `${Prefix}${Key & string}`]: Elem[Key] }
        | _ToDotNotation<Elem[Key], `${Prefix}${Key & string}.`>
        )
      : { [Path in `${Prefix}${Key & string}`]: Elem[Key] }
}[keyof Elem] extends infer Value
  ? Value
  : never

type CropTrailingDot<Str extends string> =
  Str extends `${infer T}.`
    ? T
    : Str;

type Merge<Ts> = Expand<UnionToIntersection<Ts>>

type UnionToIntersection<U> = (U extends any ? (arg: U) => any : never) extends ((arg: infer I) => void) ? I : never

// If it works like, this, I can just remove it
type Expand<T> = T

// type Expand<T> = T extends object
//   ? T extends infer O
//     ? { [K in keyof O]: O[K] }
//     : never
//   : T;
