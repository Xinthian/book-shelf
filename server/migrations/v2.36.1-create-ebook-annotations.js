const migrationVersion = '2.36.1'
const migrationName = `${migrationVersion}-create-ebook-annotations`
const loggerPrefix = `[${migrationVersion} migration]`

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)
  if (await queryInterface.tableExists('ebookAnnotations')) {
    logger.info(`${loggerPrefix} table "ebookAnnotations" already exists`)
    logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
    return
  }

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
  await queryInterface.createTable('ebookAnnotations', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    libraryItemId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: { tableName: 'libraryItems' },
        key: 'id'
      },
      onDelete: 'CASCADE'
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
    color: DataTypes.STRING,
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: { tableName: 'users' },
        key: 'id'
      },
      onDelete: 'CASCADE'
    }
  })
  await queryInterface.addIndex('ebookAnnotations', ['userId', 'libraryItemId', 'fileId'], {
    name: 'ebook_annotations_user_item_file'
  })
  await queryInterface.addIndex('ebookAnnotations', ['updatedAt'])
  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)
  if (await queryInterface.tableExists('ebookAnnotations')) {
    await queryInterface.dropTable('ebookAnnotations')
  }
  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
