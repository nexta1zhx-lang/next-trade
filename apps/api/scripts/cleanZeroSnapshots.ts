import {db} from '../src/db/index.js'
import {accountSnapshots} from '../src/db/schema.js'
import {sql} from 'drizzle-orm'

async function main() {
  const result = await db
    .delete(accountSnapshots)
    .where(sql`total_net_value::numeric = 0 OR total_net_value IS NULL`)
    .returning({id: accountSnapshots.id})
  console.log('Deleted', result.length, 'zero-value snapshots')
  process.exit(0)
}

main()
