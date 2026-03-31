"""
Router FastAPI pour la gestion des documents de la base de connaissances.
Expose :
  - POST /documents        : ingère un document (texte ou fichier) et le vectorise
  - GET  /documents        : liste les documents indexés
  - DELETE /documents/{id} : supprime un document et son embedding Qdrant
"""
