import { expect, it } from 'vitest';
import { createProfileService } from './auth.js';

it('rejects a malformed visitor ID before querying profiles', async () => {
  // The pool connects lazily, so an invalid ID must fail without touching the database.
  const service = createProfileService('postgresql://unused:unused@127.0.0.1:1/unused');
  await expect(service.getProfile('guest-token')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
});
