'use client'

export const dynamic = 'force-dynamic'

import { useParams } from 'next/navigation'
import JobForm from '@/components/JobForm'

export default function EditJobPage() {
  const params = useParams()
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string)
  return <JobForm jobId={id} />
}
