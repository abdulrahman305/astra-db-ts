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
// noinspection DuplicatedCode

import assert from 'assert';
import { DevopsApiResponseError } from '@/src/devops';

describe('unit.devops.errors', () => {
  describe('DevopsApiResponseError construction', () => {
    it('should properly construct a DataAPIResponseError with no underlying errors given', () => {
      const rootError = { message: 'Something went wrong' } as any;
      const err = new DevopsApiResponseError(rootError);
      assert.strictEqual(err.message, 'Something went wrong');
      assert.deepStrictEqual(err.errors, []);
      assert.strictEqual(err.status, undefined);
      assert.deepStrictEqual(err.rootError, rootError);
      assert.strictEqual(err.name, 'DevopsApiResponseError')
    });

    it('should properly construct a DataAPIResponseError with underlying errors', () => {
      const rootError = {
        message: 'Something went wrong',
        response: {
          data: {
            errors: [
              { message: 'Error 1' },
              { message: 'Error 2' },
            ],
          },
        },
      } as any;
      const err = new DevopsApiResponseError(rootError);
      assert.strictEqual(err.message, 'Error 1');
      assert.deepStrictEqual(err.errors, [{ message: 'Error 1' }, { message: 'Error 2' }]);
      assert.strictEqual(err.status, undefined);
      assert.deepStrictEqual(err.rootError, rootError);
      assert.strictEqual(err.name, 'DevopsApiResponseError')
    });
  });
});
