import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PmBridgeService } from './pm-bridge.service';
import { PmHoldTokenService } from './pm-hold-token.service';

// Hit from Daniel's email client — no session cookie. Guarded by the signed token only.
// GET renders a confirm page (so email link-prefetchers can't trigger the action);
// the actual mutation is the POST the page submits.
@Controller('pm-bridge/holds')
export class PmHoldsController {
  constructor(
    private readonly service: PmBridgeService,
    private readonly tokens: PmHoldTokenService,
  ) {}

  @Public()
  @Get(':id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  approvePage(@Param('id') id: string, @Query('t') t: string) {
    return this.confirmPage(id, t, 'approve', 'Approve and build this in Jira?');
  }

  @Public()
  @Get(':id/reject')
  @Header('Content-Type', 'text/html; charset=utf-8')
  rejectPage(@Param('id') id: string, @Query('t') t: string) {
    return this.confirmPage(id, t, 'reject', 'Reject and discard this request?');
  }

  @Public()
  @Post(':id/approve')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async approve(@Param('id') id: string, @Query('t') t: string) {
    const { itemId } = await this.tokens.verify(t);
    if (itemId !== id) return this.resultPage('This link is not valid.');
    const r = await this.service.approveHold(id);
    return this.resultPage(r.status === 'approved' ? 'Approved — building it in Jira now.' : 'This request was already handled.');
  }

  @Public()
  @Post(':id/reject')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async reject(@Param('id') id: string, @Query('t') t: string) {
    const { itemId } = await this.tokens.verify(t);
    if (itemId !== id) return this.resultPage('This link is not valid.');
    const r = await this.service.rejectHold(id);
    return this.resultPage(r.status === 'rejected' ? 'Rejected — nothing was created.' : 'This request was already handled.');
  }

  private confirmPage(id: string, t: string, action: 'approve' | 'reject', prompt: string): string {
    const safeT = encodeURIComponent(t ?? '');
    return `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>PM Bridge</h2><p>${prompt}</p>
<form method="post" action="/api/pm-bridge/holds/${id}/${action}?t=${safeT}">
<button type="submit" style="padding:.6rem 1.4rem;font-size:1rem">${action === 'approve' ? 'Approve' : 'Reject'}</button>
</form></body></html>`;
  }

  private resultPage(message: string): string {
    return `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">
<h2>PM Bridge</h2><p>${message}</p></body></html>`;
  }
}
