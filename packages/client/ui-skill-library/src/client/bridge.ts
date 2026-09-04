/** Native bridge used to proxy SkillHub downloads from the desktop shell. */

export interface SkillHubBridge {
  request(request: { readonly action: 'downloadSkill'; readonly slug: string }): Promise<{ readonly path: string }>
}

