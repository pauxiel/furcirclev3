/**
 * Unit tests for src/lib/wellness.ts
 */

import { assignCategory, recalcScore, computeWellnessScore } from '../../src/lib/wellness';

describe('assignCategory', () => {
  it('matches training keywords', () => {
    expect(assignCategory('Teach sit, come, down and stay')).toBe('trainingBehaviour');
    expect(assignCategory('Practice recall in the garden')).toBe('trainingBehaviour');
    expect(assignCategory('Leash walking session')).toBe('trainingBehaviour');
    expect(assignCategory('Practice stay command')).toBe('trainingBehaviour');
  });

  it('matches feeding keywords', () => {
    expect(assignCategory('Feed twice daily with puppy food')).toBe('feedingNutrition');
    expect(assignCategory('Monitor food intake and weight')).toBe('feedingNutrition');
    expect(assignCategory('Adjust diet for growth')).toBe('feedingNutrition');
    expect(assignCategory('Give water bowl fresh daily')).toBe('feedingNutrition');
  });

  it('matches health keywords', () => {
    expect(assignCategory('Schedule vaccination booster')).toBe('health');
    expect(assignCategory('Book vet check-up')).toBe('health');
    expect(assignCategory('Groom coat twice a week')).toBe('health');
    expect(assignCategory('Check dental hygiene')).toBe('health');
    expect(assignCategory('Monitor weight weekly')).toBe('health');
  });

  it('matches socialisation keywords', () => {
    expect(assignCategory('Expose to new people and dogs')).toBe('socialisation');
    expect(assignCategory('Visit the dog park')).toBe('socialisation');
    expect(assignCategory('Social walk with other dogs')).toBe('socialisation');
    expect(assignCategory('New experience at the park')).toBe('socialisation');
  });

  it('defaults to trainingBehaviour for unmatched text', () => {
    expect(assignCategory('Something completely random')).toBe('trainingBehaviour');
    expect(assignCategory('')).toBe('trainingBehaviour');
  });

  it('is case insensitive', () => {
    expect(assignCategory('TEACH SIT AND STAY')).toBe('trainingBehaviour');
    expect(assignCategory('VACCINATION due')).toBe('health');
  });
});

describe('recalcScore', () => {
  it('increases score by 2 for completed_task', () => {
    expect(recalcScore(50, 'completed_task')).toBe(52);
  });

  it('decreases score by 1 for skipped_task', () => {
    expect(recalcScore(50, 'skipped_task')).toBe(49);
  });

  it('clamps score at 100 (no overflow)', () => {
    expect(recalcScore(99, 'completed_task')).toBe(100);
    expect(recalcScore(100, 'completed_task')).toBe(100);
  });

  it('clamps score at 0 (no underflow)', () => {
    expect(recalcScore(0, 'skipped_task')).toBe(0);
    expect(recalcScore(1, 'skipped_task')).toBe(0);
  });
});

describe('computeWellnessScore', () => {
  it('returns average of 4 categories rounded', () => {
    expect(
      computeWellnessScore({
        trainingBehaviour: 80,
        feedingNutrition: 60,
        health: 70,
        socialisation: 90,
      }),
    ).toBe(75);
  });

  it('rounds 0.5 up', () => {
    expect(
      computeWellnessScore({
        trainingBehaviour: 51,
        feedingNutrition: 50,
        health: 50,
        socialisation: 50,
      }),
    ).toBe(50); // (51+50+50+50)/4 = 50.25 → 50
  });

  it('handles all zeros', () => {
    expect(
      computeWellnessScore({
        trainingBehaviour: 0,
        feedingNutrition: 0,
        health: 0,
        socialisation: 0,
      }),
    ).toBe(0);
  });

  it('handles all 100', () => {
    expect(
      computeWellnessScore({
        trainingBehaviour: 100,
        feedingNutrition: 100,
        health: 100,
        socialisation: 100,
      }),
    ).toBe(100);
  });
});
