'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { PageHeader } from '../../components/PageHeader';
import { AddVoiceModal } from '../../components/AddVoiceModal';
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
  const [showAdd, setShowAdd] = useState(false);

  const [sorting, setSorting]             = useState<SortingState>([{ id: 'name', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter]   = useState('');

  const reload = () =>
    api.listVoiceovers()
      .then(setVoices)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => { reload(); }, []);

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
        <audio key={row.original.checksum} controls preload="none"
          src={`${api.voiceoverRawUrl(row.original.id)}?v=${row.original.checksum}`} className="h-8 max-w-[14rem]" />
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
      <PageHeader
        crumbs={[{ label: 'Overview', href: '/' }, { label: 'Озвучка' }]}
        title="Озвучка — актёры"
        subtitle={
          <span className="block max-w-3xl">
            Общая библиотека голосов для voice-clone движков (XTTS-v2 / F5). Один голос хранится
            один раз в <code className="text-zinc-600">data/_voices/&lt;slug&gt;/</code> и назначается
            любому числу проектов. Загруженные файлы с одинаковым содержимым склеиваются по md5.
          </span>
        }
      />

      <main className="p-4 sm:p-8 space-y-6">
        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 font-mono text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* Add a new voice to the library — YouTube link or file, with a trim step */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Добавь голос с YouTube или из файла — аудио скачивается на сервер, дальше выберешь фрагмент на волне.
          </p>
          <button onClick={() => setShowAdd(true)}
            className="text-sm px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white whitespace-nowrap">
            ＋ Добавить голос
          </button>
        </div>

        {showAdd && (
          <AddVoiceModal onClose={() => setShowAdd(false)} onCreated={reload} />
        )}

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
