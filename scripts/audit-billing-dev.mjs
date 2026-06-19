#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const Database = require('better-sqlite3')

const dbPath = process.argv[2] || '.freechat/data/freechat.db'
const db = new Database(dbPath, { readonly: true })

const MICRO = 10000
const incomeTypes = new Set(['agent_income', 'model_income', 'platform_income', 'scene_income'])
const credit = (n) => Number((Number(n || 0) / MICRO).toFixed(4))

function all(sql, ...args) { return db.prepare(sql).all(...args) }
function get(sql, ...args) { return db.prepare(sql).get(...args) }
function addIssue(issues, level, code, message, details = {}) { issues.push({ level, code, message, details }) }

const issues = []
const users = all(`
  SELECT u.id, u.username, u.nickname, COALESCE(ca.balance, 0) balance, COALESCE(ca.income_balance, 0) income_balance
  FROM users u
  LEFT JOIN credit_accounts ca ON ca.user_id = u.id
  ORDER BY u.username
`)

const userSummaries = []
for (const user of users) {
  const txs = all('SELECT rowid, * FROM credit_transactions WHERE user_id = ? ORDER BY created_at, rowid', user.id)
  let expectedBalance = 0
  let expectedIncome = 0
  let lastSpendBalance = 0
  let lastIncomeBalance = 0
  const txByType = {}
  for (const tx of txs) {
    txByType[tx.type] = (txByType[tx.type] || 0) + tx.amount
    if (incomeTypes.has(tx.type)) {
      expectedIncome += tx.amount
      lastIncomeBalance = expectedIncome
      if (tx.balance_after !== expectedIncome) {
        addIssue(issues, 'error', 'TX_INCOME_BALANCE_AFTER_MISMATCH', `${user.username} income tx balance_after mismatch`, { userId: user.id, txId: tx.id, type: tx.type, expectedCredits: credit(expectedIncome), actualCredits: credit(tx.balance_after) })
      }
    } else {
      expectedBalance += tx.amount
      lastSpendBalance = expectedBalance
      if (tx.balance_after !== expectedBalance) {
        addIssue(issues, 'error', 'TX_BALANCE_AFTER_MISMATCH', `${user.username} balance tx balance_after mismatch`, { userId: user.id, txId: tx.id, type: tx.type, expectedCredits: credit(expectedBalance), actualCredits: credit(tx.balance_after) })
      }
    }
  }
  if (Number(user.balance) !== expectedBalance) {
    addIssue(issues, 'error', 'ACCOUNT_BALANCE_MISMATCH', `${user.username} account balance != transaction-derived balance`, { userId: user.id, accountCredits: credit(user.balance), expectedCredits: credit(expectedBalance) })
  }
  if (Number(user.income_balance) !== expectedIncome) {
    addIssue(issues, 'error', 'ACCOUNT_INCOME_BALANCE_MISMATCH', `${user.username} income_balance != transaction-derived income`, { userId: user.id, accountCredits: credit(user.income_balance), expectedCredits: credit(expectedIncome) })
  }
  userSummaries.push({
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    balanceCredits: credit(user.balance),
    expectedBalanceCredits: credit(expectedBalance),
    incomeBalanceCredits: credit(user.income_balance),
    expectedIncomeCredits: credit(expectedIncome),
    transactionCount: txs.length,
    txByTypeCredits: Object.fromEntries(Object.entries(txByType).map(([k, v]) => [k, credit(v)])),
  })
}

const ledgerRows = all('SELECT * FROM billing_ledger_entries')
for (const row of ledgerRows) {
  const expectedAmount = row.direction === 'debit' ? -row.amount : row.amount
  const tx = get('SELECT COALESCE(SUM(amount), 0) amount, COUNT(*) count FROM credit_transactions WHERE ledger_id = ? AND user_id = ?', row.id, row.account_user_id)
  if (!tx || tx.count === 0) {
    addIssue(issues, 'warn', 'LEDGER_WITHOUT_WALLET_TX', 'Ledger entry has no linked wallet transaction', { ledgerId: row.id, userId: row.account_user_id, entryType: row.entry_type, expectedCredits: credit(expectedAmount) })
  } else if (Number(tx.amount) !== expectedAmount) {
    addIssue(issues, 'error', 'LEDGER_WALLET_AMOUNT_MISMATCH', 'Ledger linked wallet amount mismatch', { ledgerId: row.id, userId: row.account_user_id, entryType: row.entry_type, expectedCredits: credit(expectedAmount), actualCredits: credit(tx.amount) })
  }
}

for (const ap of all('SELECT ap.*, a.owner_id FROM agent_purchases ap LEFT JOIN agents a ON a.id = ap.agent_template_id WHERE ap.status = ?', 'completed')) {
  if (ap.price_microcredits <= 0) continue
  const buyerTx = get(`SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM credit_transactions WHERE user_id = ? AND type = 'agent_purchase' AND amount = ?`, ap.buyer_user_id, -ap.price_microcredits)
  if (!buyerTx || buyerTx.count === 0) addIssue(issues, 'error', 'AGENT_PURCHASE_BUYER_TX_MISSING', 'Agent purchase missing buyer deduction', { purchaseId: ap.id, buyerUserId: ap.buyer_user_id, priceCredits: credit(ap.price_microcredits) })
  if (ap.owner_id) {
    const ownerTx = get(`SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM credit_transactions WHERE user_id = ? AND type = 'agent_income' AND amount = ?`, ap.owner_id, ap.price_microcredits)
    if (!ownerTx || ownerTx.count === 0) addIssue(issues, 'error', 'AGENT_PURCHASE_OWNER_TX_MISSING', 'Agent purchase missing owner income', { purchaseId: ap.id, ownerUserId: ap.owner_id, priceCredits: credit(ap.price_microcredits) })
  }
}

for (const sp of all('SELECT sp.*, st.owner_id FROM scene_purchases sp LEFT JOIN scene_templates st ON st.id = sp.scene_template_id WHERE sp.status = ?', 'completed')) {
  if (sp.price_microcredits <= 0) continue
  const buyerTx = get(`SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM credit_transactions WHERE user_id = ? AND type = 'scene_purchase' AND amount = ?`, sp.user_id, -sp.price_microcredits)
  if (!buyerTx || buyerTx.count === 0) addIssue(issues, 'error', 'SCENE_PURCHASE_BUYER_TX_MISSING', 'Scene purchase missing buyer deduction', { purchaseId: sp.id, buyerUserId: sp.user_id, priceCredits: credit(sp.price_microcredits) })
  if (sp.owner_id) {
    const ownerTx = get(`SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM credit_transactions WHERE user_id = ? AND type = 'scene_income' AND amount = ?`, sp.owner_id, sp.price_microcredits)
    if (!ownerTx || ownerTx.count === 0) addIssue(issues, 'error', 'SCENE_PURCHASE_OWNER_TX_MISSING', 'Scene purchase missing owner income', { purchaseId: sp.id, ownerUserId: sp.owner_id, priceCredits: credit(sp.price_microcredits) })
  }
}

const orphans = all(`
  SELECT ct.*
  FROM credit_transactions ct
  WHERE ct.type IN ('usage_charge', 'model_usage_charge', 'agent_usage_charge')
    AND ct.ledger_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.run_id = ct.run_id AND ct.run_id IS NOT NULL)
`)
for (const tx of orphans) {
  addIssue(issues, 'warn', 'ORPHAN_USAGE_CHARGE', 'Usage charge exists only as wallet transaction; billing UI can show it but project/model may be unrecoverable', { userId: tx.user_id, txId: tx.id, runId: tx.run_id, amountCredits: credit(tx.amount), note: tx.note })
}

const pendingUsage = all("SELECT status, COUNT(*) count FROM metered_usage_events WHERE status IN ('pending','failed','ignored') GROUP BY status")
const staleRuns = all("SELECT status, COUNT(*) count FROM agent_runs WHERE status IN ('running','pending') GROUP BY status")
const summary = {
  dbPath,
  users: userSummaries,
  issueCounts: issues.reduce((acc, item) => { acc[item.level] = (acc[item.level] || 0) + 1; return acc }, {}),
  issues,
  pendingUsage,
  staleRuns,
}
console.log(JSON.stringify(summary, null, 2))
if (issues.some((item) => item.level === 'error')) process.exitCode = 1
