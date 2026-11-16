import { describe, expect, it } from 'vitest'
import { validateDateRange } from './date-range'
describe('scientific calendar period validation',()=>{
 it('accepts an inclusive single UTC day and valid leap day',()=>{
  expect(validateDateRange('2024-02-29','2024-02-29')).toBeNull()
  expect(validateDateRange('2023-12-31','2024-01-01')).toBeNull()
 })
 it('rejects impossible dates and incomplete editing before a query is sent',()=>{
  expect(validateDateRange('2023-02-29','2023-03-01')).not.toBeNull()
  expect(validateDateRange('2024-02-30','2024-03-01')).not.toBeNull()
  expect(validateDateRange('','2024-03-01')).not.toBeNull()
 })
 it('rejects reversed periods without changing their dates',()=>{
  expect(validateDateRange('2024-11-01','2024-10-31')).toBe('The end date must be on or after the start date.')
 })
})
