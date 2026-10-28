let counter = 1;

function generateUuid() {
  const hex = (counter++).toString(16).padStart(12, '0');
  return `11111111-2222-3333-4444-${hex}`;
}

module.exports = {
  v4: generateUuid,
  v1: generateUuid,
};
