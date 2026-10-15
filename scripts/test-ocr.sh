# Test du système OCR

echo "=== Test du système OCR ==="

# 1. Vérifier la clé Gemini
echo "1. Vérification de la clé Gemini :"
if [ -f "/home/belloumi/Bureau/BelloSuite/.env.vercel-test" ]; then
    KEY=$(grep GEMINI_API_KEY= /home/belloumi/Bureau/BelloSuite/.env.vercel-test | cut -d= -f2 | tr -d '"')
    if [ -n "$KEY" ]; then
        echo "   ✓ Clé Gemini trouvée : ${KEY:0:12}..."
    else
        echo "   ✗ Clé Gemini non trouvée"
    fi
else
    echo "   ! Fichier .env.vercel-test non trouvé"
fi

# 2. Vérifier Groq
echo "2. Vérification de la clé Groq :"
if [ -f "/home/belloumi/Bureau/BelloSuite/.env.vercel-test" ]; then
    KEY=$(grep GROQ_API_KEY= /home/belloumi/Bureau/BelloSuite/.env.vercel-test | cut -d= -f2 | tr -d '"')
    if [ -n "$KEY" ]; then
        echo "   ✓ Clé Groq trouvée : ${KEY:0:12}..."
    else
        echo "   ! Clé Groq non configurée (optionnel)"
    fi
else
    echo "   ! Fichier .env.vercel-test non trouvé"
fi

# 3. Vérifier ParseFlow
echo "3. Vérification de la clé ParseFlow :"
if [ -f "/home/belloumi/Bureau/BelloSuite/.env.vercel-test" ]; then
    KEY=$(grep PARSEFLOW_API_KEY= /home/belloumi/Bureau/BelloSuite/.env.vercel-test | cut -d= -f2 | tr -d '"')
    if [ -n "$KEY" ]; then
        echo "   ✓ Clé ParseFlow trouvée : ${KEY:0:12}..."
    else
        echo "   ! Clé ParseFlow non configurée (optionnel, 100 docs/mois gratuits)"
    fi
else
    echo "   ! Fichier .env.vercel-test non trouvé"
fi

# 4. Vérifier les fichiers créés
echo "4. Vérification des fichiers créés :"
FILES=(
    "prisma/schema/scanned-document.prisma"
    "src/lib/ai-invoice.ts"
    "src/app/api/scan/documents/route.ts"
    "src/app/api/scan/search-semantic/route.ts"
    "src/components/scan/ScanSearchPanel.tsx"
    "src/app/[locale]/(dashboard)/commercial/scan/page.tsx"
    "docs/ocr-solutions.md"
)

for f in "${FILES[@]}"; do
    if [ -f "/home/belloumi/Bureau/BelloSuite/$f" ]; then
        echo "   ✓ $f"
    else
        echo "   ✗ $f"
    fi
done

# 5. Vérifier les traductions
echo "5. Vérification des traductions :"
KEYS=(
    "Purchases.scan_search.title"
    "Purchases.scan_search.placeholder"
    "Purchases.scan_search.all_docs"
    "Purchases.scan_search.supplier_filter"
    "Purchases.scan_search.sort_date_desc"
    "Purchases.scan_search.sort_date_asc"
    "Purchases.scan_search.sort_amount_desc"
    "Purchases.scan_search.sort_amount_asc"
    "Purchases.scan_search.sort_relevance"
    "Purchases.scan_search.clear"
    "Purchases.scan_search.no_results"
    "Purchases.scan_search.search_error"
    "Purchases.scan_search.semantic_search"
    "Purchases.scan_search.result_count"
)

for key in "${KEYS[@]}"; do
    if grep -q "$key" /home/belloumi/Bureau/BelloSuite/messages/fr.json; then
        echo "   ✓ $key"
    else
        echo "   ✗ $key"
    fi
done

echo "=== Fin du test ==="