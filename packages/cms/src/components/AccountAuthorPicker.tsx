/** @jsxImportSource react */
'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useAuth, useDocumentInfo, useField } from '@payloadcms/ui'

type Account = { id: string | number; name: string; avatarUrl: string | null }
const idOf = (value: any) => value && typeof value === 'object' ? value.id : value
const same = (a: any, b: any) => String(idOf(a) ?? '') === String(idOf(b) ?? '')

// Real accounts are selectable before they have an editorial profile. Reads
// never provision anything; one explicit click adds a byline to the native form.
export default function AccountAuthorPicker() {
  const { user } = useAuth()
  const { id } = useDocumentInfo()
  const { value: authors, setValue } = useField<any[]>({ path: 'authors' })
  const { value: creator } = useField<any>({ path: 'createdBy' })
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Account | null>(null)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ name: string; editURL: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const currentID = useRef(id)
  currentID.current = id
  const generation = useRef(0)
  const active = useRef(true)
  const pending = useRef(false)
  const latestAuthors = useRef(authors)
  latestAuthors.current = authors
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++ } }, [])
  useEffect(() => {
    generation.current++; pending.current = false
    setBusy(false); setQuery(''); setPage(1); setAccounts([]); setSelected(null); setResult(null); setError('')
  }, [id])
  const preferredID = idOf(creator) ?? user?.id
  useEffect(() => {
    const controller = new AbortController()
    const sourceURL = window.location.href
    setLoading(true); setError('')
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, page: String(page) })
        if (!query && preferredID != null) params.set('include', String(preferredID))
        const response = await fetch(`/payload-api/authors/accounts?${params}`, { credentials: 'same-origin', signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.errors?.[0]?.message || 'Could not load staff accounts.')
        if (controller.signal.aborted || window.location.href !== sourceURL) return
        setAccounts(previous => page === 1 ? data.accounts : [...previous, ...data.accounts.filter((a: Account) => !previous.some(p => same(p.id, a.id)))])
        setNextPage(data.nextPage)
        setSelected(previous => previous || data.accounts.find((a: Account) => same(a.id, preferredID)) || null)
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load staff accounts.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, 200)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [id, query, page, preferredID, retry])
  const add = async () => {
    if (!selected || pending.current) return
    pending.current = true; setBusy(true); setError(''); setResult(null)
    const operation = ++generation.current
    const sourceURL = window.location.href
    const original = JSON.stringify(latestAuthors.current ?? [])
    try {
      const response = await fetch('/payload-api/authors/account/profile', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountID: selected.id }),
      })
      const data = await response.json()
      if (!active.current || operation !== generation.current || currentID.current !== id || window.location.href !== sourceURL) return
      if (!response.ok) throw new Error(data.errors?.[0]?.message || 'Could not add this account as an author.')
      // Do not clobber a newer manual edit or another control's selection.
      if (original !== JSON.stringify(latestAuthors.current ?? [])) throw new Error('Author credits changed while loading. Review them and try again.')
      const existing = latestAuthors.current ?? []
      if (!existing.some(value => same(value, data.author.id))) setValue([...existing.map(idOf), data.author.id])
      setResult({ name: data.author.name, editURL: data.editURL })
    } catch (e) {
      if (active.current && operation === generation.current && window.location.href === sourceURL)
        setError(e instanceof Error ? e.message : 'Could not add this account as an author.')
    } finally {
      if (active.current && operation === generation.current) { pending.current = false; setBusy(false) }
    }
  }
  return <section aria-label="Choose an account author" style={{ marginBottom: '1rem' }}>
    <h3>Add a real account as author</h3>
    <p>Choose an existing staff account, even if they have no author profile yet. Adding keeps the other authors. Created by records who made the article; it does not automatically change older bylines.</p>
    <label>Search staff accounts <input value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} /></label>
    <div role="radiogroup" aria-label="Staff account authors" aria-busy={loading}>
      {accounts.map(account => <label key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8 }}>
        <input type="radio" name={`account-author-${id ?? 'new'}`} checked={same(selected?.id, account.id)} onChange={() => { setSelected(account); setResult(null) }} disabled={busy} />
        {account.avatarUrl && <img src={account.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: 8, objectFit: 'cover' }} />}
        <span>{account.name}{same(account.id, creator) ? ' (Created by)' : ''}</span>
      </label>)}
    </div>
    {loading && <p role="status">Loading accounts…</p>}
    {!loading && !accounts.length && <p>No matching staff accounts.</p>}
    {nextPage && <button type="button" disabled={loading} onClick={() => setPage(nextPage)}>More accounts</button>}
    <button type="button" disabled={!selected || busy} onClick={add}>{busy ? 'Adding account…' : 'Add account as author'}</button>
    {selected && <p>Selected: {selected.name}. Save Draft or Publish applies the byline.</p>}
    {result && <p role="status">Added {result.name}. <a href={result.editURL} target="_blank" rel="noopener noreferrer">Edit linked author profile</a></p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>Reload accounts</button></p>}
  </section>
}
