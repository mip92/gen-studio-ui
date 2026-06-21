'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table';
import { api, type Voiceover } from '../../lib/api';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { HeaderCell, MultiSelect, MultiSelectLabeled } from '../../components/table/TableControls';

/**
 * Озвучка — the shared voice library ("voice actors"). Same table stack as the
 * queue (@tanstack/react-table + shared HeaderCell / MultiSelect controls), so
 * sorting (click a header) and per-column filtering (Проекты / Источник /
 * Формат dropdowns + a name search) behave identically. Client-side here — the
 * library is small (no pagination / server round-trips needed). Click a row to
 * open its detail page.
 */
export default function VoicesPage() {
  const [voices, setVoices]   = useState<Voiceover[] | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl]   = useState('');
  const fileRef               = useRef<HTMLInputElement>(null);

  const [sorting, setSorting]             = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter]   = useState('');

  const reload = () =>
    api.listVoiceovers()
      .then(setVoices)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => { reload(); }, []);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      await api.createVoiceover(file, {
        name:      newName.trim() || undefined,
        sourceUrl: newUrl.trim()  || undefined,
      });
      setNewName(''); setNewUrl('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const rows = voices ?? [];

  // Distinct values for the column-filter dropdowns, derived from the data.
  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of rows) for (const p of v.projects) m.set(p.id, p.name);
    return [...m.entries()].map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);
  const extOptions = useMemo(
    () => [...new Set(rows.map((v) => v.ext.replace('.', '')))].sort(),
    [rows],
  );

  const columns = useMemo<ColumnDef<Voiceover>[]>(() => [
    {
      id: 'name', accessorKey: 'name', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Голос" column={column} />,
      cell: ({ row }) => (
        <div>
          <Link href={`/voices/${row.original.id}`} className="font-medium text-zinc-100 hover:text-blue-400">
            {row.original.name}
          </Link>
          <div className="text-[11px] text-zinc-600 font-mono">{row.original.slug}</div>
        </div>
      ),
    },
    {
      id: 'preview', enableSorting: false, enableColumnFilter: false,
      header: () => <span className="text-left">Превью</span>,
      cell: ({ row }) => (
        <audio controls preload="none" src={api.voiceoverRawUrl(row.original.id)} className="h-8 max-w-[14rem]" />
      ),
    },
    {
      id: 'projects',
      accessorFn: (v) => v.assignedCount,           // sort by how many projects use it
      enableSorting: true, enableColumnFilter: true,
      filterFn: (row, _id, val: string[]) =>
        !val?.length || row.original.projects.some((p) => val.includes(p.id)),
      header: ({ column }) => (
        <HeaderCell
          label="Проекты"
          column={column}
          filter={
            <MultiSelectLabeled
              options={projectOptions}
              value={(column.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
            />
          }
        />
      ),
      cell: ({ row }) => (
        row.original.projects.length === 0
          ? <span className="text-zinc-600 italic text-xs">не назначен</span>
          : (
            <div className="flex flex-wrap gap-1">
              {row.original.projects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}
                  className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-blue-700 hover:text-blue-300">
                  {p.name}
                </Link>
              ))}
            </div>
          )
      ),
    },
    {
      id: 'source',
      accessorFn: (v) => (v.sourceUrl ? 1 : 0),     // sort: linked first/last
      enableSorting: true, enableColumnFilter: true,
      filterFn: (row, _id, val: string[]) =>
        !val?.length || val.includes(row.original.sourceUrl ? 'has' : 'none'),
      header: ({ column }) => (
        <HeaderCell
          label="Источник"
          column={column}
          filter={
            <MultiSelectLabeled
              options={[{ value: 'has', label: 'со ссылкой' }, { value: 'none', label: 'без ссылки' }]}
              value={(column.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
            />
          }
        />
      ),
      cell: ({ row }) => (
        row.original.sourceUrl
          ? <a href={row.original.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 text-xs underline break-all" title={row.original.sourceUrl}>↗ ссылка</a>
          : <span className="text-zinc-700 text-xs">—</span>
      ),
    },
    {
      id: 'ext',
      accessorFn: (v) => v.ext.replace('.', ''),
      enableSorting: true, enableColumnFilter: true,
      filterFn: (row, _id, val: string[]) =>
        !val?.length || val.includes(row.original.ext.replace('.', '')),
      header: ({ column }) => (
        <HeaderCell
          label="Формат"
          column={column}
          filter={
            <MultiSelect
              options={extOptions}
              value={(column.getFilterValue() as string[] | undefined) ?? []}
              onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
            />
          }
        />
      ),
      cell: ({ row }) => (
        <span className="text-[11px] font-mono text-zinc-500 uppercase">{row.original.ext.replace('.', '')}</span>
      ),
    },
    {
      id: 'bytes', accessorKey: 'bytes', enableSorting: true, enableColumnFilter: false,
      header: ({ column }) => <HeaderCell label="Размер" column={column} />,
      cell: ({ getValue }) => (
        <span className="text-[11px] text-zinc-400 font-mono whitespace-nowrap">{formatBytes(getValue() as number)}</span>
      ),
    },
  ], [projectOptions, extOptions]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange:       setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange:  setGlobalFilter,
    globalFilterFn: (row, _id, q: string) =>
      !q || `${row.original.name} ${row.original.slug}`.toLowerCase().includes(q.toLowerCase()),
    getCoreRowModel:     getCoreRowModel(),
    getSortedRowModel:   getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;

  return (
    <div className="bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto">
          <Breadcrumbs items={[{ label: 'Overview', href: '/' }, { label: 'Озвучка' }]} />
          <h1 className="text-xl font-semibold">Озвучка — актёры</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-3xl">
            Общая библиотека голосов для voice-clone движков (XTTS-v2 / F5). Один голос хранится
            один раз в <code className="text-zinc-600">data/_voices/&lt;slug&gt;/</code> и назначается
            любому числу проектов. Загруженные файлы с одинаковым содержимым склеиваются по md5.
          </p>
        </div>
      </header>

      <main className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* Add a new voice to the library */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Имя (необязательно)</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="напр. Захар (мужской, низкий)"
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-64" />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[16rem]">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">Ссылка-источник (YouTube, необязательно)</label>
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm w-full font-mono" />
          </div>
          <label className={`text-sm px-4 py-2 rounded cursor-pointer self-end ${
            busy ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-emerald-700 hover:bg-emerald-600 text-white'
          }`}>
            {busy ? 'Загрузка…' : '⬆ Добавить голос'}
            <input ref={fileRef} type="file" accept="audio/*" hidden disabled={busy}
              onChange={(e) => onUpload(e.target.files?.[0])} />
          </label>
        </div>

        {!voices && !error && <p className="text-zinc-500">Loading…</p>}

        {voices && (
          <>
            {/* Name search + result count */}
            <div className="flex items-center gap-3">
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="поиск по имени / slug…"
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm w-64"
              />
              <span className="text-xs text-zinc-500">{visibleRows.length} из {rows.length}</span>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="bg-zinc-950 text-zinc-400 text-xs uppercase tracking-wider align-top">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>
                      {hg.headers.map((h) => (
                        <th key={h.id} className="text-left px-3 py-2 font-normal">
                          {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length} className="px-3 py-8 text-center text-zinc-600 italic">
                        — нет голосов по этим фильтрам —
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-900/50">
                      {r.getVisibleCells().map((c) => (
                        <td key={c.id} className="px-3 py-2 align-top">
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
