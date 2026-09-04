const { DataTypes, Model } = require('sequelize')

class EbookAnnotation extends Model {
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true
        },
        libraryItemId: {
          type: DataTypes.UUID,
          allowNull: false
        },
        fileId: DataTypes.STRING,
        type: {
          type: DataTypes.STRING,
          allowNull: false
        },
        cfi: {
          type: DataTypes.TEXT,
          allowNull: false
        },
        selectedText: DataTypes.TEXT,
        note: DataTypes.TEXT,
        color: DataTypes.STRING
      },
      {
        sequelize,
        modelName: 'ebookAnnotation',
        indexes: [
          {
            name: 'ebook_annotations_user_item_file',
            fields: ['userId', 'libraryItemId', 'fileId']
          },
          {
            fields: ['updatedAt']
          }
        ]
      }
    )

    const { libraryItem, user } = sequelize.models
    user.hasMany(EbookAnnotation, { onDelete: 'CASCADE' })
    EbookAnnotation.belongsTo(user)
    libraryItem.hasMany(EbookAnnotation, { onDelete: 'CASCADE' })
    EbookAnnotation.belongsTo(libraryItem)
  }
}

module.exports = EbookAnnotation
