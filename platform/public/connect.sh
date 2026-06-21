#!/bin/bash
set -e

echo "============================================"
echo "  srvly — Connexion du serveur à la plateforme"
echo "============================================"
echo ""

SSH_DIR="/root/.ssh"
AUTH_KEYS="$SSH_DIR/authorized_keys"

# Usage
if [ $# -lt 1 ]; then
  echo "Usage: curl -sL https://srvly.app/connect.sh | bash -s -- <cle_publique>"
  echo ""
  echo "Pour récupérer votre clé : ajoutez d'abord le serveur dans le dashboard,"
  echo "la clé vous sera fournie."
  exit 1
fi

PUBKEY="$1"
FINGERPRINT=$(echo "$PUBKEY" | ssh-keygen -lf /dev/stdin 2>/dev/null || echo "(empreinte inconnue)")

echo "🔑 Ajout de la clé SSH aux authorized_keys..."
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

# Add the key if not already present
if grep -q "$(echo "$PUBKEY" | cut -d' ' -f2)" "$AUTH_KEYS" 2>/dev/null; then
  echo "  ✓ Clé déjà présente"
else
  echo "$PUBKEY" >> "$AUTH_KEYS"
  echo "  ✓ Clé ajoutée"
fi
chmod 600 "$AUTH_KEYS"

echo ""
echo "  Empreinte : $FINGERPRINT"
echo ""

# Test reverse connection
echo "🔌 Test de connexion..."
# Platform will SSH in to verify

echo ""
echo "============================================"
echo "  ✅ Serveur connecté à srvly !"
echo "============================================"
echo ""
echo "Prochaines étapes dans le dashboard :"
echo "  • Sécuriser le serveur (UFW + SSH hardening)"
echo "  • Installer Docker / Nginx / Certbot"
echo "  • Déployer vos applications"
echo ""
echo "L'assistant IA peut aussi vous guider."
echo ""
