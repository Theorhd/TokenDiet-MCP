import { describe, it, expect } from 'vitest';
import { displayPath, hashRoot, guessRole } from '../../src/core/paths.js';

describe('paths', () => {
  describe('displayPath', () => {
    it('returns relative path when file is inside root', () => {
      const root = '/User/project';
      const file = '/User/project/src/index.ts';
      expect(displayPath(root, file)).toBe('src/index.ts');
    });

    it('returns absolute path when file is outside root', () => {
      const root = '/User/project';
      const file = '/User/other/src/index.ts';
      expect(displayPath(root, file)).toBe('/User/other/src/index.ts');
    });
  });

  describe('hashRoot', () => {
    it('generates a consistent hash for the same root', () => {
      const root = '/User/project/TokenDiet';
      expect(hashRoot(root)).toBe(hashRoot(root));
    });

    it('generates different hashes for different roots', () => {
      const root1 = '/User/project/TokenDiet';
      const root2 = '/User/project/OtherProject';
      expect(hashRoot(root1)).not.toBe(hashRoot(root2));
    });
  });

  describe('guessRole', () => {
    it('identifies entry-points', () => {
      expect(guessRole('/src/index.ts')).toBe('entry-point');
      expect(guessRole('/src/main.go')).toBe('entry-point');
      expect(guessRole('/app/server.js')).toBe('entry-point');
      expect(guessRole('/app.ts')).toBe('entry-point');
    });

    it('identifies tests', () => {
      expect(guessRole('/src/utils.test.ts')).toBe('test');
      expect(guessRole('/src/utils.spec.js')).toBe('test');
      expect(guessRole('/test/fixtures/data.json')).toBe('test');
      expect(guessRole('/__tests__/component.tsx')).toBe('test');
    });

    it('identifies components', () => {
      expect(guessRole('/src/components/Button.tsx')).toBe('component');
      expect(guessRole('/src/component/Header.vue')).toBe('component');
    });

    it('identifies configs', () => {
      expect(guessRole('/vitest.config.ts')).toBe('config');
      expect(guessRole('/config/database.js')).toBe('config');
    });

    it('identifies utilities', () => {
      expect(guessRole('/src/utils/math.ts')).toBe('utility');
      expect(guessRole('/src/helpers/date.js')).toBe('utility');
    });

    it('identifies hooks', () => {
      expect(guessRole('/src/hooks/useAuth.ts')).toBe('hook');
      expect(guessRole('/src/composables/useData.ts')).toBe('hook');
    });

    it('identifies middleware', () => {
      expect(guessRole('/src/middleware/auth.ts')).toBe('middleware');
    });

    it('identifies routes', () => {
      expect(guessRole('/src/routes/api.ts')).toBe('route');
      expect(guessRole('/src/pages/home.tsx')).toBe('route');
    });

    it('identifies models', () => {
      expect(guessRole('/src/models/user.ts')).toBe('model');
      expect(guessRole('/src/schema/db.ts')).toBe('model');
      expect(guessRole('/src/entity/Post.ts')).toBe('model');
    });

    it('defaults to source', () => {
      expect(guessRole('/src/core/parser.ts')).toBe('source');
      expect(guessRole('/src/unknown.txt')).toBe('source');
    });
  });
});
