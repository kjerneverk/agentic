import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager, type ContextStats } from '../src/context-manager';
import type { DynamicContentItem } from '../src/types';

describe('ContextManager', () => {
    let manager: ContextManager;

    beforeEach(() => {
        manager = new ContextManager();
    });

    describe('track', () => {
        it('should track a context item', () => {
            const item: DynamicContentItem = {
                content: 'Test content',
                title: 'Test Title',
            };

            manager.track(item, 5);

            expect(manager.getAll()).toHaveLength(1);
        });

        it('should auto-generate ID if not provided', () => {
            manager.track({ content: 'Content' }, 0);

            const items = manager.getAll();
            expect(items[0].id).toMatch(/^ctx-\d+-[a-z0-9]+$/);
        });

        it('should use provided ID', () => {
            manager.track({ id: 'custom-id', content: 'Content' }, 0);

            expect(manager.hasContext('custom-id')).toBe(true);
        });

        it('should skip duplicate content by hash for items without ID', () => {
            manager.track({ content: 'Same content' }, 0);
            manager.track({ content: 'Same content' }, 1);

            expect(manager.getAll()).toHaveLength(1);
        });

        it('should not skip duplicate content if item has ID', () => {
            manager.track({ id: 'item1', content: 'Same content' }, 0);
            manager.track({ id: 'item2', content: 'Same content' }, 1);

            expect(manager.getAll()).toHaveLength(2);
        });

        it('should set default priority to medium', () => {
            manager.track({ content: 'Content' }, 0);

            const items = manager.getAll();
            expect(items[0].priority).toBe('medium');
        });

        it('should preserve provided priority', () => {
            manager.track({ content: 'Content', priority: 'high' }, 0);

            const items = manager.getAll();
            expect(items[0].priority).toBe('high');
        });

        it('should set injectedAt timestamp', () => {
            const beforeTime = new Date();
            manager.track({ content: 'Content' }, 0);
            const afterTime = new Date();

            const items = manager.getAll();
            expect(items[0].injectedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            expect(items[0].injectedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        });

        it('should record position', () => {
            manager.track({ content: 'Content' }, 42);

            const items = manager.getAll();
            expect(items[0].position).toBe(42);
        });
    });

    describe('hasContext', () => {
        it('should return true for existing ID', () => {
            manager.track({ id: 'test-id', content: 'Content' }, 0);

            expect(manager.hasContext('test-id')).toBe(true);
        });

        it('should return false for non-existing ID', () => {
            expect(manager.hasContext('nonexistent')).toBe(false);
        });
    });

    describe('hasContentHash', () => {
        it('should return true for existing content', () => {
            manager.track({ content: 'Unique content' }, 0);

            expect(manager.hasContentHash('Unique content')).toBe(true);
        });

        it('should return false for new content', () => {
            manager.track({ content: 'Content A' }, 0);

            expect(manager.hasContentHash('Content B')).toBe(false);
        });
    });

    describe('hasSimilarContent', () => {
        it('should find exact match', () => {
            manager.track({ content: 'Exact content' }, 0);

            expect(manager.hasSimilarContent('Exact content')).toBe(true);
        });

        it('should find normalized match (whitespace)', () => {
            manager.track({ content: 'Content  with   spaces' }, 0);

            expect(manager.hasSimilarContent('Content with spaces')).toBe(true);
        });

        it('should find substring match above threshold', () => {
            manager.track({ content: 'This is the full content' }, 0);

            // 'This is the full conten' is 95% of 'This is the full content'
            expect(manager.hasSimilarContent('This is the full conten')).toBe(true);
        });

        it('should not match dissimilar content', () => {
            manager.track({ content: 'Original content here' }, 0);

            expect(manager.hasSimilarContent('Completely different')).toBe(false);
        });
    });

    describe('get', () => {
        it('should return tracked item by ID', () => {
            manager.track({ id: 'item-1', content: 'Content 1' }, 0);

            const item = manager.get('item-1');

            expect(item?.content).toBe('Content 1');
        });

        it('should return undefined for non-existing ID', () => {
            expect(manager.get('nonexistent')).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('should return all tracked items', () => {
            manager.track({ id: 'a', content: 'A' }, 0);
            manager.track({ id: 'b', content: 'B' }, 1);
            manager.track({ id: 'c', content: 'C' }, 2);

            expect(manager.getAll()).toHaveLength(3);
        });

        it('should return empty array when nothing tracked', () => {
            expect(manager.getAll()).toEqual([]);
        });
    });

    describe('getByCategory', () => {
        it('should filter by category', () => {
            manager.track({ id: 'a', content: 'A', category: 'code' }, 0);
            manager.track({ id: 'b', content: 'B', category: 'docs' }, 1);
            manager.track({ id: 'c', content: 'C', category: 'code' }, 2);

            const codeItems = manager.getByCategory('code');

            expect(codeItems).toHaveLength(2);
            expect(codeItems.every(i => i.category === 'code')).toBe(true);
        });
    });

    describe('getByPriority', () => {
        it('should filter by priority', () => {
            manager.track({ id: 'a', content: 'A', priority: 'high' }, 0);
            manager.track({ id: 'b', content: 'B', priority: 'low' }, 1);
            manager.track({ id: 'c', content: 'C', priority: 'high' }, 2);

            const highPriority = manager.getByPriority('high');

            expect(highPriority).toHaveLength(2);
        });
    });

    describe('getBySource', () => {
        it('should filter by source', () => {
            manager.track({ id: 'a', content: 'A', source: 'file' }, 0);
            manager.track({ id: 'b', content: 'B', source: 'api' }, 1);
            manager.track({ id: 'c', content: 'C', source: 'file' }, 2);

            const fileItems = manager.getBySource('file');

            expect(fileItems).toHaveLength(2);
        });
    });

    describe('getCategories', () => {
        it('should return unique categories sorted', () => {
            manager.track({ id: 'a', content: 'A', category: 'zebra' }, 0);
            manager.track({ id: 'b', content: 'B', category: 'alpha' }, 1);
            manager.track({ id: 'c', content: 'C', category: 'zebra' }, 2);
            manager.track({ id: 'd', content: 'D', category: 'beta' }, 3);

            const categories = manager.getCategories();

            expect(categories).toEqual(['alpha', 'beta', 'zebra']);
        });

        it('should return empty array if no categories', () => {
            manager.track({ id: 'a', content: 'A' }, 0);

            expect(manager.getCategories()).toEqual([]);
        });
    });

    describe('getStats', () => {
        it('should return comprehensive statistics', () => {
            manager.track({ id: 'a', content: 'A', category: 'code', priority: 'high', source: 'file' }, 0);
            manager.track({ id: 'b', content: 'B', category: 'code', priority: 'low', source: 'api' }, 1);
            manager.track({ id: 'c', content: 'C', category: 'docs', priority: 'high', source: 'file' }, 2);

            const stats = manager.getStats();

            expect(stats.totalItems).toBe(3);
            expect(stats.byCategory.get('code')).toBe(2);
            expect(stats.byCategory.get('docs')).toBe(1);
            expect(stats.byPriority.get('high')).toBe(2);
            expect(stats.byPriority.get('low')).toBe(1);
            expect(stats.bySource.get('file')).toBe(2);
            expect(stats.bySource.get('api')).toBe(1);
        });

        it('should track timestamp range', () => {
            const timestamp1 = new Date('2024-01-01');
            const timestamp2 = new Date('2024-06-01');
            const timestamp3 = new Date('2024-03-01');

            manager.track({ id: 'a', content: 'A', timestamp: timestamp1 }, 0);
            manager.track({ id: 'b', content: 'B', timestamp: timestamp2 }, 1);
            manager.track({ id: 'c', content: 'C', timestamp: timestamp3 }, 2);

            const stats = manager.getStats();

            expect(stats.oldestTimestamp).toEqual(timestamp1);
            expect(stats.newestTimestamp).toEqual(timestamp2);
        });
    });

    describe('remove', () => {
        it('should remove item by ID', () => {
            manager.track({ id: 'to-remove', content: 'Content' }, 0);

            const result = manager.remove('to-remove');

            expect(result).toBe(true);
            expect(manager.hasContext('to-remove')).toBe(false);
        });

        it('should return false for non-existing ID', () => {
            const result = manager.remove('nonexistent');

            expect(result).toBe(false);
        });

        it('should also remove from hash set', () => {
            manager.track({ id: 'item', content: 'Unique content' }, 0);
            manager.remove('item');

            // Now the same content can be added again
            manager.track({ content: 'Unique content' }, 1);
            expect(manager.getAll()).toHaveLength(1);
        });
    });

    describe('clear', () => {
        it('should remove all items', () => {
            manager.track({ id: 'a', content: 'A' }, 0);
            manager.track({ id: 'b', content: 'B' }, 1);
            manager.track({ id: 'c', content: 'C' }, 2);

            manager.clear();

            expect(manager.getAll()).toEqual([]);
        });

        it('should clear hash set too', () => {
            manager.track({ content: 'Content' }, 0);
            manager.clear();

            // Same content should be trackable again
            manager.track({ content: 'Content' }, 1);
            expect(manager.getAll()).toHaveLength(1);
        });
    });
});

