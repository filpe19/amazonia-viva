/** Validate ISO calendar dates without changing UTC or scientific day boundaries. */
export function validateDateRange(start:string,end:string):string|null {
  const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
  if(!valid(start)||!valid(end))return 'Enter a valid start and end date.'
  if(start>end)return 'The end date must be on or after the start date.'
  return null
}
