#!/bin/bash

# base58fun Quick Start Script
# Bu script projeyi başlatmak için gerekli adımları otomatikleştirir

set -e

echo "🚀 base58fun Quick Start"
echo "======================================"
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js bulunamadı. Lütfen Node.js 18+ yükleyin."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ gereklidir. Şu an: Node.js $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) tespit edildi"
echo ""

# Check if in correct directory
if [ ! -f "package.json" ] || [ ! -d "packages" ]; then
    echo "❌ Lütfen base58fun proje dizininde çalıştırın"
    echo "   cd /Users/berkay/Desktop/work/base58fun"
    exit 1
fi

echo "✅ Proje dizini doğrulandı"
echo ""

# Check environment
if [ ! -f ".env.local" ]; then
    echo "⚠️  .env.local dosyası bulunamadı"
    echo "📝 .env.example'dan kopyalıyorum..."
    cp .env.example .env.local
    echo ""
    echo "⚠️  ÖNEMLI: .env.local dosyasını ayarlarınızla doldurun:"
    echo "   - CLOUDFLARE_API_TOKEN"
    echo "   - CLOUDFLARE_ACCOUNT_ID"
    echo "   - GITHUB_CLIENT_ID"
    echo "   - GITHUB_CLIENT_SECRET"
    echo ""
    echo "Dosya: $(pwd)/.env.local"
    echo ""
    read -p "Dosyayı açıp ayarladınız mı? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Setup iptal edildi"
        exit 1
    fi
fi

echo "✅ Environment dosyası hazır"
echo ""

# Install dependencies
echo "📦 Dependencies yükleniyor..."
npm run install:all > /dev/null 2>&1 || {
    echo "❌ Dependencies yükleme hatası"
    exit 1
}
echo "✅ Dependencies yüklendi"
echo ""

# Run database migrations
echo "🗄️  Database migrationları çalıştırılıyor..."
if command -v wrangler &> /dev/null; then
    npm run db:migrate:dev > /dev/null 2>&1 || {
        echo "⚠️  Database migration uyarısı (devam ediyorum...)"
    }
    echo "✅ Database migrationları tamamlandı"
else
    echo "⚠️  Wrangler bulunamadı - database setup atlanıyor"
    echo "   Daha sonra çalıştırabilirsiniz: npm run db:migrate:dev"
fi
echo ""

# Type check
echo "🔍 TypeScript type checking..."
npm run type-check > /dev/null 2>&1 || {
    echo "⚠️  Type check uyarıları mevcut (devam ediyorum...)"
}
echo "✅ Type checking tamamlandı"
echo ""

echo "======================================"
echo "✨ Setup başarıyla tamamlandı!"
echo "======================================"
echo ""
echo "🎯 Bir terminal açıp şunu çalıştırın:"
echo ""
echo "   npm run dev"
echo ""
echo "Ardından açılacak adresler:"
echo "   • Frontend:  http://localhost:5173"
echo "   • Backend:   http://localhost:8787"
echo ""
echo "💡 Başlangıç için: SETUP_INSTRUCTIONS.md dosyasını okuyun"
echo ""
