// Test to verify test_command parameter is properly defined
const { RequestReviewHandler } = require('../dist/tools/request-review.js');

// Get the tool definition
const toolDef = RequestReviewHandler.getToolDefinition();

// Check if test_command is in the properties
const hasTestCommand = 'test_command' in toolDef.inputSchema.properties;
const testCommandDef = toolDef.inputSchema.properties.test_command;

console.log('✓ Tool definition check:');
console.log(`  - Has test_command parameter: ${hasTestCommand}`);
console.log(`  - test_command type: ${testCommandDef?.type}`);
console.log(`  - test_command description: ${testCommandDef?.description}`);

// Verify it's not in required fields
const isRequired = toolDef.inputSchema.required.includes('test_command');
console.log(`  - Is optional: ${!isRequired}`);

if (hasTestCommand && testCommandDef?.type === 'string' && !isRequired) {
  console.log('\n✓ test_command parameter correctly configured');
  process.exit(0);
} else {
  console.error('\n✗ test_command parameter configuration error');
  process.exit(1);
}