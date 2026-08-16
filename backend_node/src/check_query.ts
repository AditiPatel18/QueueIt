import { supabase } from './config/supabase';
import { fallbackDb } from './utils/schemaFallback';

async function run() {
  try {
    const userId = 'd82b0aef-77ae-4f18-9221-af638ac60cf3';
    await fallbackDb.ready;
    const selectCols = fallbackDb.getOptimizedSelectString();
    console.log('selectCols:', selectCols);

    let query = supabase.from('items').select(selectCols, { count: 'exact' }).eq('user_id', userId);
    query = query.order('added_at', { ascending: false });
    query = query.range(0, 49);

    const { data: dbItems, count, error } = await query;
    if (error) {
      console.error('Supabase Query Error:', error);
    } else {
      console.log('Supabase Query Success:');
      console.log('Count:', count);
      console.log('Items returned:', dbItems?.length);
      if (dbItems) {
        console.log('First item:', dbItems[0]);
      }
    }
  } catch (err) {
    console.error('Error running check:', err);
  }
}

run();
