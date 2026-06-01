/**
 * AI Analysis Queue Processor — handles import document processing jobs.
 *
 * Job data shape when reportType === 'import_document':
 *   { orgId, reportType: 'import_document', params: { jobId: string } }
 */

import { processImportJob } from '../../services/importJob.service';

export async function handleAiAnalysisJob(
  reportType: string,
  params: Record<string, unknown>,
  orgId: string,
  log: (msg: string) => void,
): Promise<Record<string, unknown>> {

  if (reportType === 'import_document') {
    const jobId = params['jobId'] as string | undefined;
    if (!jobId) throw new Error('Missing jobId in params for import_document job');

    log(`Processing import job ${jobId} for org ${orgId}`);
    await processImportJob(jobId);
    log(`Import job ${jobId} completed`);
    return { jobId, status: 'completed' };
  }

  // Legacy / future AI report types
  log(`AI analysis job received: ${reportType} for org ${orgId} — params: ${JSON.stringify(params)}`);
  return { status: 'queued_for_future_implementation', reportType };
}
