import { forward } from '../../../bff/proxy';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(request: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return forward(request, path.join('/'));
}

export const dynamic = 'force-dynamic';
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
