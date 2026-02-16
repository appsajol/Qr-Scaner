
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rgrctlosgjyzsmrhagbf.supabase.co';
const supabaseKey = 'sb_publishable_ijuyws07hoVJ6zuHLUKKbw_4ruOJr5h';

export const supabase = createClient(supabaseUrl, supabaseKey);
