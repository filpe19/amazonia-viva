import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search } from 'lucide-react'
import { columnVisibilityFeature, createPaginatedRowModel, createSortedRowModel, rowPaginationFeature, rowSortingFeature, sortFns, tableFeatures, useTable, type ColumnDef, type ColumnVisibilityState } from '@tanstack/react-table'
import { t, useLocale } from '../lib/i18n'
import { fmtInt } from '../lib/format'
import { useSessionState } from '../lib/useSessionState'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

const features = tableFeatures({ columnVisibilityFeature, rowSortingFeature, rowPaginationFeature, sortedRowModel:createSortedRowModel(), paginatedRowModel:createPaginatedRowModel(), sortFns })
export interface DataColumn<T> {
  id:string; label:string; unit?:string; accessor:(row:T)=>string|number|null|undefined
  cell?:(row:T)=>ReactNode; required?:boolean; numeric?:boolean; sortable?:boolean
}
export function DataTable<T extends object>({ id, title, data, columns, getRowId, searchText, description, initialHidden=[] }: {
  id:string; title:string; data:T[]; columns:DataColumn<T>[]; getRowId:(row:T)=>string
  searchText:(row:T)=>string; description?:ReactNode; initialHidden?:string[]
}) {
  const { locale } = useLocale()
  const [search,setSearch]=useState('')
  const [visibility,setVisibility]=useSessionState<ColumnVisibilityState>(`av:table:${id}:columns`,Object.fromEntries(initialHidden.map(k=>[k,false])))
  const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase(locale)
  const filtered=useMemo(()=>{const q=normalize(search).trim();return q?data.filter(row=>normalize(searchText(row)).includes(q)):data},[data,search,searchText,locale])
  const defs=useMemo<ColumnDef<typeof features,T>[]>(()=>columns.map(c=>({id:c.id,header:t(c.label),accessorFn:c.accessor,enableHiding:!c.required,enableSorting:c.sortable!==false,cell:ctx=>c.cell?.(ctx.row.original)??(c.accessor(ctx.row.original)??'—')})),[columns,locale])
  const table=useTable({features,columns:defs,data:filtered,getRowId,state:{columnVisibility:visibility},onColumnVisibilityChange:setVisibility,initialState:{pagination:{pageIndex:0,pageSize:10}}})
  const page=table.state.pagination
  return <div className="data-explorer" data-table-id={id}>
    {description&&<p className="data-context">{description}</p>}
    <div className="data-toolbar">
      <label className="table-search"><Search size={15} aria-hidden="true"/><span className="sr-only">{t('Search table')}</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('Search these records…')}/></label>
      <span className="data-result-count" role="status">{t('{0} of {1} records',{'0':fmtInt(filtered.length),'1':fmtInt(data.length)})}</span>
      <Popover><PopoverTrigger render={<Button variant="outline"/>}><Columns3 size={15} aria-hidden="true"/>{t('Columns')}</PopoverTrigger>
        <PopoverContent align="end" className="column-picker"><PopoverTitle>{t('Visible columns')}</PopoverTitle><p>{t('Column choices change this view; original exports keep all fields.')}</p>
          {table.getAllLeafColumns().map(column=><label key={column.id}><input type="checkbox" checked={column.getIsVisible()} disabled={!column.getCanHide()} onChange={column.getToggleVisibilityHandler()}/>{t(columns.find(c=>c.id===column.id)?.label??column.id)}</label>)}
        </PopoverContent>
      </Popover>
    </div>
    <Table aria-label={title}>
      <TableCaption className="sr-only">{title}. {t('Sort using column headings. Units are shown beside each variable.')}</TableCaption>
      <TableHeader>{table.getHeaderGroups().map(group=><TableRow key={group.id}>{group.headers.map(header=>{const c=columns.find(c=>c.id===header.column.id)!;const sorted=header.column.getIsSorted();return <TableHead key={header.id} aria-sort={sorted==='asc'?'ascending':sorted==='desc'?'descending':undefined} className={c.numeric?'text-right':undefined}>
        {header.column.getCanSort()?<button type="button" className="data-sort" onClick={header.column.getToggleSortingHandler()}>{t(c.label)}{c.unit&&<small>{c.unit}</small>}{sorted==='asc'?<ArrowUp size={13} aria-hidden="true"/>:sorted==='desc'?<ArrowDown size={13} aria-hidden="true"/>:<ArrowUpDown size={13} aria-hidden="true"/>}</button>:<>{t(c.label)}{c.unit&&<small>{c.unit}</small>}</>}
      </TableHead>})}</TableRow>)}</TableHeader>
      <TableBody>{table.getRowModel().rows.length?table.getRowModel().rows.map(row=><TableRow key={row.id}>{row.getVisibleCells().map(cell=><TableCell key={cell.id} className={columns.find(c=>c.id===cell.column.id)?.numeric?'num text-right':undefined}><table.FlexRender cell={cell}/></TableCell>)}</TableRow>):<TableRow><TableCell colSpan={table.getVisibleLeafColumns().length} className="table-empty">{t(data.length?'No records match your search.':'No records available for this query.')}</TableCell></TableRow>}</TableBody>
    </Table>
    <p className="data-scroll-hint">{t("Scroll horizontally to see all visible columns.")}</p>
    <div className="data-pagination"><label>{t('Rows per page')}<select aria-label={t('Rows per page')} value={page.pageSize} onChange={e=>table.setPageSize(Number(e.target.value))}>{[10,25,50].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <span>{t('Page {0} of {1}',{'0':fmtInt(page.pageIndex+1),'1':fmtInt(Math.max(1,table.getPageCount()))})}</span>
      <Button variant="outline" size="icon" aria-label={t('Previous page')} disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}><ChevronLeft aria-hidden="true"/></Button>
      <Button variant="outline" size="icon" aria-label={t('Next page')} disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}><ChevronRight aria-hidden="true"/></Button>
    </div>
  </div>
}
