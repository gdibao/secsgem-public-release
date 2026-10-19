import { describe, expect, it } from 'vitest';

import { builtinSkills } from '..';
import { builtinSkillManifests } from '../manifests';
import { FabEngineeringSkill, fabEngineeringSkills, fabSkillDefinitions } from '.';

describe('FAB engineering builtin skill manifests', () => {
  it('registers the umbrella skill and every FAB skill with the native loader', () => {
    const expected = [FabEngineeringSkill, ...fabEngineeringSkills];
    const manifestsByIdentifier = new Map(
      builtinSkillManifests.map((manifest) => [manifest.identifier, manifest]),
    );

    expect(fabSkillDefinitions).toHaveLength(32);
    expect(expected).toHaveLength(33);
    expect(new Set(expected.map((skill) => skill.identifier)).size).toBe(33);

    for (const skill of expected) {
      expect(manifestsByIdentifier.get(skill.identifier)).toEqual({
        avatar: skill.avatar,
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
        source: skill.source,
        title: skill.title,
      });
      expect(builtinSkills.find((item) => item.identifier === skill.identifier)?.content).toBe(
        skill.content,
      );
    }
  });
});
