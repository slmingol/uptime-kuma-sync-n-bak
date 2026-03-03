const { describe, it } = require('node:test');
const assert = require('node:assert');
const UptimeKumaSync = require('./uptime-kuma-sync.js');

describe('UptimeKumaSync', () => {
  describe('cleanMonitorData', () => {
    let syncer;

    // Create a syncer instance before tests
    const config = {
      sourceUrl: 'http://test:3001',
      sourceUsername: 'test',
      sourcePassword: 'test',
      targetUrl: 'http://test:3002',
      targetUsername: 'test',
      targetPassword: 'test',
      excludedFields: ['interval', 'retryInterval', 'timeout']
    };

    syncer = new UptimeKumaSync(config);

    it('should initialize array fields with sensible defaults', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com'
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.deepStrictEqual(cleaned.notificationIDList, []);
      // HTTP monitors get sensible default for accepted_statuscodes
      assert.deepStrictEqual(cleaned.accepted_statuscodes, ['200-299']);
    });

    it('should preserve existing array values when not in excludedFields', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        notificationIDList: [1, 2, 3],
        accepted_statuscodes: ['200', '201']
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      // Arrays should be preserved if not in excludedFields
      assert.deepStrictEqual(cleaned.notificationIDList, [1, 2, 3]);
      assert.deepStrictEqual(cleaned.accepted_statuscodes, ['200', '201']);
    });

    it('should reset array values to empty when in excludedFields', () => {
      // Create a syncer with notificationIDList in excludedFields
      const syncerWithArraysExcluded = new UptimeKumaSync({
        ...config,
        excludedFields: ['interval', 'notificationIDList', 'accepted_statuscodes']
      });

      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        notificationIDList: [1, 2, 3],
        accepted_statuscodes: ['200', '201']
      };

      const cleaned = syncerWithArraysExcluded.cleanMonitorData(monitor);

      // notificationIDList should be reset to empty when in excludedFields
      assert.deepStrictEqual(cleaned.notificationIDList, []);
      // accepted_statuscodes should get sensible default for HTTP monitors
      assert.deepStrictEqual(cleaned.accepted_statuscodes, ['200-299']);
    });

    it('should use sensible defaults for HTTP monitor accepted_statuscodes', () => {
      const syncerWithExclusion = new UptimeKumaSync({
        ...config,
        excludedFields: ['accepted_statuscodes']
      });

      const httpMonitor = {
        name: 'HTTP Monitor',
        type: 'http',
        url: 'https://example.com',
        accepted_statuscodes: ['200']
      };

      const cleaned = syncerWithExclusion.cleanMonitorData(httpMonitor);

      // HTTP monitors should get 200-299 default when accepted_statuscodes is excluded
      assert.deepStrictEqual(cleaned.accepted_statuscodes, ['200-299']);
    });

    it('should handle non-HTTP monitor types for accepted_statuscodes', () => {
      const syncerWithExclusion = new UptimeKumaSync({
        ...config,
        excludedFields: ['accepted_statuscodes']
      });

      const pingMonitor = {
        name: 'Ping Monitor',
        type: 'ping',
        hostname: 'example.com'
      };

      const cleaned = syncerWithExclusion.cleanMonitorData(pingMonitor);

      // Non-HTTP monitors should get empty array for accepted_statuscodes
      assert.deepStrictEqual(cleaned.accepted_statuscodes, []);
    });

    it('should remove instance-specific internal fields', () => {
      const monitor = {
        id: 123,
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        userId: 456,
        created_date: '2024-01-01',
        updated_date: '2024-01-02',
        docker_host: 789,
        parent: 101
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual(cleaned.id, undefined);
      assert.strictEqual(cleaned.userId, undefined);
      assert.strictEqual(cleaned.created_date, undefined);
      assert.strictEqual(cleaned.updated_date, undefined);
      assert.strictEqual(cleaned.docker_host, undefined);
      assert.strictEqual(cleaned.parent, undefined);
    });

    it('should remove auto-generated fields', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        path: '/some/path',
        path_name: 'path-name'
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual(cleaned.path, undefined);
      assert.strictEqual(cleaned.path_name, undefined);
    });

    it('should remove malformed children_i_ds field', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        children_i_ds: 'bad-value',
        children_ids: 'another-bad',
        childrenIds: 'yet-another'
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual(cleaned.children_i_ds, undefined);
      assert.strictEqual(cleaned.children_ids, undefined);
      assert.strictEqual(cleaned.childrenIds, undefined);
    });

    it('should remove undefined values', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        undefinedField: undefined,
        anotherUndefined: undefined
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual('undefinedField' in cleaned, false);
      assert.strictEqual('anotherUndefined' in cleaned, false);
    });

    it('should remove malformed _i_d fields but preserve tag_id and monitor_id', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        tag_id: 123,
        monitor_id: 456,
        bad_i_d_field: 789,
        another_i_d_problem: 'test'
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual(cleaned.tag_id, 123);
      assert.strictEqual(cleaned.monitor_id, 456);
      assert.strictEqual(cleaned.bad_i_d_field, undefined);
      assert.strictEqual(cleaned.another_i_d_problem, undefined);
    });

    it('should remove excluded fields from config', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        interval: 60,
        retryInterval: 30,
        timeout: 10,
        maxretries: 3
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      // These are in excludedFields
      assert.strictEqual(cleaned.interval, undefined);
      assert.strictEqual(cleaned.retryInterval, undefined);
      assert.strictEqual(cleaned.timeout, undefined);
      // This is not in our test config excludedFields
      assert.strictEqual(cleaned.maxretries, 3);
    });

    it('should preserve essential monitor fields', () => {
      const monitor = {
        name: 'Test Monitor',
        type: 'http',
        url: 'https://example.com',
        active: true,
        hostname: 'example.com',
        port: 443
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      assert.strictEqual(cleaned.name, 'Test Monitor');
      assert.strictEqual(cleaned.type, 'http');
      assert.strictEqual(cleaned.url, 'https://example.com');
      assert.strictEqual(cleaned.active, true);
      assert.strictEqual(cleaned.hostname, 'example.com');
      assert.strictEqual(cleaned.port, 443);
    });

    it('should handle complex monitor with multiple issues', () => {
      const monitor = {
        id: 999,
        name: 'Complex Monitor',
        type: 'http',
        url: 'https://example.com',
        active: true,
        userId: 1,
        created_date: '2024-01-01',
        docker_host: 5,
        parent: 10,
        path: '/test',
        children_i_ds: 'malformed',
        notificationIDList: [1, 2],
        accepted_statuscodes: ['200'],
        interval: 60,
        tag_id: 789,
        bad_i_d: 'remove-me',
        undefinedValue: undefined
      };

      const cleaned = syncer.cleanMonitorData(monitor);

      // Should be removed
      assert.strictEqual(cleaned.id, undefined);
      assert.strictEqual(cleaned.userId, undefined);
      assert.strictEqual(cleaned.created_date, undefined);
      assert.strictEqual(cleaned.docker_host, undefined);
      assert.strictEqual(cleaned.parent, undefined);
      assert.strictEqual(cleaned.path, undefined);
      assert.strictEqual(cleaned.children_i_ds, undefined);
      assert.strictEqual(cleaned.interval, undefined);
      assert.strictEqual(cleaned.bad_i_d, undefined);
      assert.strictEqual('undefinedValue' in cleaned, false);

      // Should be preserved (notificationIDList and accepted_statuscodes are NOT in our test excludedFields)
      assert.strictEqual(cleaned.name, 'Complex Monitor');
      assert.strictEqual(cleaned.type, 'http');
      assert.strictEqual(cleaned.url, 'https://example.com');
      assert.strictEqual(cleaned.active, true);
      assert.strictEqual(cleaned.tag_id, 789);
      assert.deepStrictEqual(cleaned.notificationIDList, [1, 2]);
      assert.deepStrictEqual(cleaned.accepted_statuscodes, ['200']);
    });
  });

  describe('JSON serialization workaround', () => {
    it('should strip undefined properties via JSON.parse(JSON.stringify())', () => {
      const monitor = {
        name: 'Test',
        type: 'http',
        url: 'https://example.com',
        undefinedField: undefined,
        nullField: null,
        validField: 'value'
      };

      const serialized = JSON.parse(JSON.stringify(monitor));

      // Undefined should be removed
      assert.strictEqual('undefinedField' in serialized, false);
      // Null should be preserved
      assert.strictEqual(serialized.nullField, null);
      // Valid fields should be preserved
      assert.strictEqual(serialized.validField, 'value');
      assert.strictEqual(serialized.name, 'Test');
    });

    it('should handle nested objects with undefined values', () => {
      const monitor = {
        name: 'Test',
        type: 'http',
        nested: {
          defined: 'value',
          undefined: undefined
        }
      };

      const serialized = JSON.parse(JSON.stringify(monitor));

      assert.strictEqual(serialized.nested.defined, 'value');
      assert.strictEqual('undefined' in serialized.nested, false);
    });
  });

  describe('Minimal monitor creation', () => {
    it('should include all required fields for server validation', () => {
      // This documents what fields are required for successful monitor creation
      const minimalMonitor = {
        name: 'Test Monitor',
        type: 'http',
        active: true,
        notificationIDList: [],
        accepted_statuscodes: ['200-299'],  // Sensible default for HTTP monitors
        conditions: {}
      };

      // These are the fields that prevent server errors:
      // - notificationIDList: prevents "Cannot read properties of undefined (reading 'every')"
      // - accepted_statuscodes: prevents "Cannot read properties of undefined (reading 'every')" AND prevents "Request failed with status code 200" errors
      // - conditions: prevents "NOT NULL constraint failed: monitor.conditions"

      assert.strictEqual(Array.isArray(minimalMonitor.notificationIDList), true);
      assert.strictEqual(Array.isArray(minimalMonitor.accepted_statuscodes), true);
      assert.strictEqual(minimalMonitor.accepted_statuscodes.length > 0, true);  // Must not be empty!
      assert.strictEqual(typeof minimalMonitor.conditions, 'object');
      assert.strictEqual(minimalMonitor.conditions !== null, true);
    });
  });
});
