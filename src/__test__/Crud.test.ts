import { Core, Entity, User, Proxy } from '@quatrain/core'
import { createUser, createUsers, setup } from './common'
import { UserCore } from '@quatrain/core/lib/components'
import { EntityCore } from '@quatrain/core/lib/components/Entity'
import { Persisted } from '@quatrain/core/lib/components/types/Persisted'

const backend = setup()
let user: Persisted<User>

beforeAll(async () => {
   Core.classRegistry['User'] = UserCore
   Core.classRegistry['Entity'] = EntityCore

   user = (await createUser()) as Persisted<User>
   await user.core.save()
})

afterAll(async () => {
   await backend.deleteCollection('user')
   //await backend.deleteCollection('entity')
})

describe('Firestore CRUD operations', () => {
   test('write data', async () => {
      // Check that object is successfully created in backend
      expect(user.core.dataObject.isPersisted()).toBe(true)
      expect(user.uri).not.toBeUndefined()
      expect(user.uid).not.toBeUndefined()
      expect(user.uri.constructor.name).toBe('ObjectUri')
   })

   test('read data', async () => {
      // Retrieve user from empty object and record path
      const user2 = await UserCore.factory()
      user2.core.dataObject.uri.path = user.core.dataObject.uri.path

      await backend.read(user2.core.dataObject)
      expect(user2.name).toBe(user.name)
   })

   test('update data', async () => {
      user.firstname = 'Jane'
      await user.core.save()

      // Retrieve user from empty object and record path
      const user2 = await UserCore.factory()
      user2.core.dataObject.uri.path = user.core.dataObject.uri.path

      await backend.read(user2.core.dataObject)
      expect(user2.name).toBe(user.name)
   })

   test('delete data', async () => {
      expect(user.uid).toBeDefined()

      await backend.delete(user.core.dataObject)
      expect(user.uid).toBeUndefined()
   })
})
