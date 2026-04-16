export type WellnessCategory = 'trainingBehaviour' | 'feedingNutrition' | 'health' | 'socialisation';
export type ActivityType = 'completed_task' | 'skipped_task';

export interface CategoryScores {
  trainingBehaviour: number;
  feedingNutrition: number;
  health: number;
  socialisation: number;
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: WellnessCategory }> = [
  { pattern: /\b(?:train|command|sit|come|stay|down|leash|recall)/i, category: 'trainingBehaviour' },
  { pattern: /\b(?:feed|food|diet|nutrition|meal|water|treat)/i, category: 'feedingNutrition' },
  { pattern: /\b(?:vaccin|vet|health|medical|groom|dental|weight)/i, category: 'health' },
  { pattern: /\b(?:social|meet|people|dog|park|expo|experience)/i, category: 'socialisation' },
];

export const assignCategory = (taskText: string): WellnessCategory => {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(taskText)) return category;
  }
  return 'trainingBehaviour';
};

export const recalcScore = (current: number, type: ActivityType): number => {
  const delta = type === 'completed_task' ? 2 : -1;
  return Math.min(100, Math.max(0, current + delta));
};

export const computeWellnessScore = (scores: CategoryScores): number => {
  const avg = (scores.trainingBehaviour + scores.feedingNutrition + scores.health + scores.socialisation) / 4;
  return Math.round(avg);
};

export const DEFAULT_CATEGORY_SCORES: CategoryScores = {
  trainingBehaviour: 50,
  feedingNutrition: 50,
  health: 50,
  socialisation: 50,
};
