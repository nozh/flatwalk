import { describe, expect, it } from 'vitest';
import { ValidationReportSchema } from '@flatwalk/contract';
import { buildFixtureValidationReport } from '../scripts/fixture-validation-report';

describe('buildFixtureValidationReport', () => {
  it('runs validate() on the prepared 54541 revision without fabricating checks', () => {
    const artifact = buildFixtureValidationReport();
    expect(ValidationReportSchema.safeParse(artifact.report).success).toBe(true);
    expect(artifact.report.modelId).toBe(artifact.model.id);
    expect(artifact.report.revision).toBe(artifact.model.revision);
    expect(artifact.model.id).toBe('cityexpert-54541');
    expect(artifact.model.revision).toBe(0);
    expect(artifact.fileName).toBe('fixtures/54541/validation/rev-000.json');
    const clearance = artifact.report.checks.find((check) => check.checkId === 'navigation.clearance');
    expect(clearance?.status).toBe('skipped');
    expect(artifact.report.walkReady).toBe(true);
    expect(JSON.parse(artifact.json)).toEqual(artifact.report);
  });
});
