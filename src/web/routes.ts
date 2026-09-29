import type { Route } from '@qqbot/sdk'
import { normalizeConfig } from '../config.js'
import { SECTIONS } from '../fields.js'
import { followDefault, groupExists, listGroups, loadGroup, removeGroup, saveDefault, saveGroup } from '../store/groups.js'
import { claimVote } from '../store/votes.js'
import { PAGE_HTML } from './page.generated.js'

/** 一次最多查多少个群名：每个群一次子请求，一次请求最多 50 个子请求 */
export const NAMES_PER_REQUEST = 40

const json = (data: unknown, status = 200) => Response.json(data, { status })

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json()
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/ui/*',
    auth: 'admin',
    handler: () => new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  },
  {
    method: 'GET',
    path: '/api/state',
    auth: 'admin',
    handler: async ({ ctx }) => json({ sections: SECTIONS, ...(await listGroups(ctx.db)) }),
  },
  {
    // 群名不存，打开页面时现查
    method: 'POST',
    path: '/api/names',
    auth: 'admin',
    handler: async ({ ctx, request }) => {
      const { ids } = await body(request)
      const list = Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string').slice(0, NAMES_PER_REQUEST) : []
      const names = await Promise.all(
        list.map((id) =>
          ctx.api.group
            .info(id)
            .then((info) => info.group_name ?? null)
            .catch(() => null),
        ),
      )
      return json({ names: Object.fromEntries(list.map((id, i) => [id, names[i]])) })
    },
  },
  {
    method: 'PUT',
    path: '/api/default',
    auth: 'admin',
    handler: async ({ ctx, request }) => {
      const { defaults } = await listGroups(ctx.db)
      const config = normalizeConfig((await body(request)).config, defaults)
      await saveDefault(ctx.db, config)
      return json({ config })
    },
  },
  {
    method: 'PUT',
    path: '/api/groups/:id',
    auth: 'admin',
    handler: async ({ ctx, request, params }) => {
      const id = params.id ?? ''
      if (!(await groupExists(ctx.db, id))) return json({ error: '没有这个群' }, 404)
      const input = await body(request)
      if (input.follow === true) {
        await followDefault(ctx.db, id)
      } else {
        const group = await loadGroup(ctx.db, id)
        await saveGroup(ctx.db, id, normalizeConfig(input.config, group.config))
      }
      const group = await loadGroup(ctx.db, id)
      return json({ id, follow: group.follow, config: group.config })
    },
  },
  {
    method: 'DELETE',
    path: '/api/groups/:id',
    auth: 'admin',
    handler: async ({ ctx, params }) => {
      const id = params.id ?? ''
      await removeGroup(ctx.db, id)
      await claimVote(ctx.db, id)
      return json({ ok: true })
    },
  },
]
