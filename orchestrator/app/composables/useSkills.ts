import type { SkillInfo } from '~/types';

export function useSkills() {
  const { data: skills, refresh } = useFetch<SkillInfo[]>('/api/skills', {
    default: () => [],
  });

  async function createSkill(data: { name: string; content: string }): Promise<SkillInfo> {
    const result = await $fetch<SkillInfo>('/api/skills', {
      method: 'POST',
      body: data,
    });
    await refresh();
    return result;
  }

  async function updateSkill(id: string, data: { name?: string; content?: string }): Promise<SkillInfo> {
    const result = await $fetch<SkillInfo>(`/api/skills/${id}`, {
      method: 'PUT',
      body: data,
    });
    await refresh();
    return result;
  }

  async function deleteSkill(id: string): Promise<void> {
    await $fetch(`/api/skills/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return {
    skills,
    refresh,
    createSkill,
    updateSkill,
    deleteSkill,
  };
}
