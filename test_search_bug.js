// Test script to reproduce the search bug with "Feelin' Alright"
// This replicates the exact normalization logic from PracticePage.jsx

const normalizeText = (str) => {
  return str
    // Normalize apostrophes and quotes
    .replace(/[''`"]/g, "'")
    // Normalize dashes and hyphens  
    .replace(/[–—−]/g, "-")
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

// Test data - simulate the items Steven sees
const testItems = [
  { 'A': '1', 'C': "Feelin' Alright" },
  { 'A': '2', 'C': "Feelin' Alright (relearning)" },
  { 'A': '3', 'C': "Tangled Up In Blue" },
  { 'A': '4', 'C': "Simple Twist of Fate (relearning)" },
  { 'A': '5', 'C': "Another Song" }
];

// Test the search logic
function testSearch(searchTerm, items, excludeItemId = null) {
  console.log(`\n=== Testing search for "${searchTerm}" ===`);
  
  const filteredItems = items.filter(item => {
    // Filter out the source item
    if (item['A'] === excludeItemId) return false;
    
    // Filter by search term
    if (searchTerm.trim()) {
      const title = item['C'] || '';
      
      const normalizedTitle = normalizeText(title);
      const normalizedSearch = normalizeText(searchTerm);
      
      // Handle empty search after normalization
      if (!normalizedSearch) return true;
      
      const matches = normalizedTitle.includes(normalizedSearch);
      console.log(`DEBUG SEARCH: "${searchTerm}" -> "${normalizedSearch}" searching in "${title}" -> "${normalizedTitle}" -> match: ${matches}`);
      
      return matches;
    }
    
    return true;
  });
  
  console.log('Filtered results:');
  filteredItems.forEach(item => console.log(`  - ${item['C']}`));
  
  return filteredItems;
}

// Test cases
testSearch('tangled', testItems, '4'); // Exclude "Simple Twist of Fate" like in the modal
testSearch('asdf test', testItems, '4'); 
testSearch('feelin', testItems, '4');

// Test apostrophe variants specifically
console.log('\n=== Testing apostrophe variants ===');
const apostropheVariants = [
  "Feelin' Alright",       // straight apostrophe (U+0027)
  "Feelin' Alright",       // right single quotation mark (U+2019)
  "Feelin` Alright",       // backtick (U+0060)
];

apostropheVariants.forEach((variant, i) => {
  console.log(`Variant ${i + 1}: ${JSON.stringify(variant)}`);
  console.log(`  Normalized: ${JSON.stringify(normalizeText(variant))}`);
  console.log(`  Unicode chars:`, Array.from(variant).map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' '));
});