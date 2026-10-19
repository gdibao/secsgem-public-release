import type { BuiltinSkillManifest } from '@lobechat/types';

import { FabEngineeringSkill, fabEngineeringSkills } from './catalog';

const toManifest = ({ content: _content, ...manifest }: (typeof fabEngineeringSkills)[number]) =>
  manifest;

export const FabEngineeringManifest: BuiltinSkillManifest = toManifest(FabEngineeringSkill);

export const fabEngineeringSkillManifests: BuiltinSkillManifest[] =
  fabEngineeringSkills.map(toManifest);
