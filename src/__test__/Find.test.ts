import { Core, Entity, Proxy, User } from '@quatrain/core'
import { setup, createUsers, createEntity, createUser } from './common'
import { UserCore } from '@quatrain/core/lib/components'
import { EntityCore } from '@quatrain/core/lib/components/Entity'

const backend = setup()

let user: Proxy<User>
let entity: Entity

beforeAll(async () => {
   Core.classRegistry['User'] = UserCore
   Core.classRegistry['Entity'] = EntityCore

   entity = await createEntity()

   user = await UserCore.factory()
   await createUsers(user)
   await createUsers(user, 3, { lastname: 'Doe' })
   await createUsers(user, 3, { entity })
   await createUsers(user, 2, { lastname: 'Doe', entity })
})

afterAll(async () => {
   // Remove collections after each test
   await Promise.all([
      backend.deleteCollection('user'),
      backend.deleteCollection('entity'),
   ])
})

describe('Firestore find() operations', () => {
   test('find all entities records', () =>
      EntityCore.query()
         .execute()
         .then((res) => expect(res.length).toBe(1)))

   test('find records with filter on string property', () =>
      // Query users named Doe
      UserCore.query()
         .where('lastname', 'Doe')
         .execute()
         .then((res) => expect(res.length).toBe(5)))

   test('find records with filter on object property', () => {
      UserCore.query()
         .where('entity', entity)
         .execute()
         .then((res) => expect(res.length).toBe(5))
   })

   test('find records with filters on string and object properties', () =>
      // Query users in entity Acme Inc.
      UserCore.query()
         .where('lastname', 'Doe')
         .where('entity', entity)
         .execute()
         .then((res) => expect(res.length).toBe(2)))

   test('find users records within batch limit', async () => {
      // Query all users without a batch value
      const query = UserCore.query()
      const res = await query.execute()
      expect(res.length).toBe(10)
   })

   test('find all users records', () =>
      // Query all users without a batch value
      UserCore.query()
         .batch(-1)
         .execute()
         .then((res) => expect(res.length).toBe(13)))
})
