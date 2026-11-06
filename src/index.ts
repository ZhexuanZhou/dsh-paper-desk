/**
 * PaperDesk Host half: a Mendeley-style paper library that lives in a plain,
 * cloud-syncable directory. Mounts the workbench HTTP API, registers the
 * `paper_*` agent tools and adds a short system-prompt section describing the
 * library. All state lives in the library directory; this plugin holds only a
 * derived, rebuildable cache.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType } from './config.js'
import { plugin as httpPlugin } from './http.js'
import { effectiveSettings } from './settings.js'
import { registerTools, type ToolRegistryLike } from './tools.js'
import { systemPromptText } from './prompt.js'
import { readPackageJson } from './util.js'

export const name = 'paper-desk'

export { Config }

/** Structural view of the Host prompt registry (optional service). */
interface PromptSectionLike {
  name: string
  order: number
  text: string | ((context: unknown) => string)
}

interface SystemPromptLike {
  section(section: PromptSectionLike): () => void
}

export function apply(ctx: Context, config: ConfigType): void {
  const pkg = readPackageJson()
  console.log(
    `[dsh-paper-desk] plugin loaded v${pkg?.version ?? '0.0.0'} (library=${config.libraryPath || '(unset)'}, language=${config.language})`,
  )

  // The workbench HTTP routes need the web server; in headless deployments the
  // child fiber simply stays pending and the tools keep working.
  ctx.plugin(httpPlugin, config)

  // Agent tools: `ctx.get` keeps the plugin usable in profiles without tools.
  const tools = ctx.get('tools') as unknown as ToolRegistryLike | undefined
  if (tools !== undefined) {
    ctx.effect(() => registerTools(tools, config), 'paper-desk: paper tools')
  }

  // Teach every agent about the library when one is configured.
  const systemPrompt = ctx.get('systemPrompt') as unknown as SystemPromptLike | undefined
  if (systemPrompt !== undefined) {
    ctx.effect(
      () =>
        systemPrompt.section({
          name: 'paper-desk',
          order: 6.5,
          text: () => systemPromptText(effectiveSettings(config)),
        }),
      'paper-desk: system prompt section',
    )
  }
}
