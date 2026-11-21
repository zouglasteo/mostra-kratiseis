/* ============================================================
   Mostra Κρατήσεις – ρυθμίσεις
   Αυτό είναι το ΜΟΝΟ αρχείο που χρειάζεται να αλλάξετε.
   ============================================================ */
window.MOSTRA_CONFIG = {

  /* 1. Σύνδεση με τη βάση δεδομένων (Supabase → Project Settings → API).
        Αν αυτά μείνουν κενά, η εφαρμογή τρέχει σε ΔΟΚΙΜΑΣΤΙΚΗ λειτουργία:
        οι κρατήσεις μένουν μόνο στη συσκευή που τις πέρασε. */
  SUPABASE_URL: 'https://utzcnxvqshciszjvvgaj.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0emNueHZxc2hjaXN6anZ2Z2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUyOTI0NzYsImV4cCI6MjExMDg2ODQ3Nn0.7Mr1zgIqTBgCHSFxuQcSa0RcxzJY79N1ZH4g4iFmNyo', // δημόσιο κλειδί· είναι ασφαλές να βρίσκεται εδώ

  /* 2. Ο κοινός λογαριασμός του προσωπικού (Supabase → Authentication → Users).
        Στην οθόνη εισόδου το προσωπικό γράφει μόνο τον κωδικό. */
  STAFF_EMAIL: 'kratiseis@mostrameze.com',

  /* 3. Ωράριο και όρια – ίδια με το Εβδομαδιαίο Πλάνο του i-host. */
  open: '12:30',             // πρώτη ώρα άφιξης
  lastArrival: '22:30',      // τελευταία ώρα άφιξης
  step: 15,                  // λεπτά ανάμεσα στις ώρες της λίστας
  closedDays: [1],           // 0=Κυρ, 1=Δευ, … 6=Σάβ
  lunchEnds: '17:00',        // ό,τι είναι πριν από αυτή την ώρα μετράει ως «Μεσημέρι»
  capacity: 60,              // συνολικά άτομα την ημέρα
  slotLimit: 20,             // μέγιστα άτομα που φτάνουν μέσα σε ένα μισάωρο

  /* 4. Ετικέτες που εμφανίζονται στη φόρμα κράτησης. */
  tags: ['Γενέθλια', 'Επέτειος', 'Παιδικό καρεκλάκι', 'Αλλεργία', 'Έξω', 'Μέσα', 'VIP', 'Instagram']
};
