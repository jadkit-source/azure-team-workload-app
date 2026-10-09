
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canDeleteTask,
  canPurgeData,
  canUploadAttachment,
  canDeleteAttachment,
  canEditDescription
} = require("../dist/src/shared/permissions.js");

const now = Date.parse("2026-10-08T12:00:00Z");

const creator = {
  id: "day6-member",
  isAdmin: false
};

const otherMember = {
  id: "day6-member2",
  isAdmin: false
};

const admin = {
  id: "day6-admin",
  isAdmin: true
};

function taskCreated(minutesAgo) {
  return {
    CreatedBy: creator.id,
    OwnerId: creator.id,
    CreatedAt: new Date(
      now - minutesAgo * 60 * 1000
    ).toISOString()
  };
}

// =====================================================
// Task deletion permission tests
// =====================================================

test("Creator can delete within one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), creator, now),
    true
  );
});

test("Another member cannot delete creator's task", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), otherMember, now),
    false
  );
});

test("Admin can delete within one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), admin, now),
    true
  );
});

test("Creator cannot delete after one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(61), creator, now),
    false
  );
});

test("Admin cannot delete after one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(61), admin, now),
    false
  );
});

test("Deletion is denied at exactly one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(60), creator, now),
    false
  );
});

// =====================================================
// Attachment permission tests
// =====================================================

test("Another member cannot upload attachments", () => {
  assert.equal(
    canUploadAttachment(taskCreated(30), otherMember),
    false
  );
});

test("Creator can upload attachments", () => {
  assert.equal(
    canUploadAttachment(taskCreated(30), creator),
    true
  );
});

test("Another member cannot delete attachments", () => {
  assert.equal(
    canDeleteAttachment(taskCreated(30), otherMember),
    false
  );
});

// =====================================================
// Data retention permission tests
// =====================================================

test("Only admin can purge data", () => {
  assert.equal(
    canPurgeData(creator),
    false
  );

  assert.equal(
    canPurgeData(otherMember),
    false
  );

  assert.equal(
    canPurgeData(admin),
    true
  );
});

// =====================================================
// Description editing permission tests
// =====================================================

test("Creator can edit Description", () => {
  assert.equal(
    canEditDescription(taskCreated(30), creator),
    true
  );
});

test("Another member cannot edit Description", () => {
  assert.equal(
    canEditDescription(taskCreated(30), otherMember),
    false
  );
});

test("Admin cannot edit another creator's Description", () => {
  assert.equal(
    canEditDescription(taskCreated(30), admin),
    false
  );
});

test("Description editing is denied without a creator", () => {
  assert.equal(
    canEditDescription({ CreatedBy: "" }, creator),
    false
  );
});
