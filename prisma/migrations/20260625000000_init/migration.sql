-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT 'Jimmy',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_isDefault_idx`(`isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('CHAT', 'IMAGE') NOT NULL,
    `title` VARCHAR(191) NOT NULL DEFAULT '新聊天',
    `userId` VARCHAR(191) NOT NULL,
    `providerConversationId` VARCHAR(191) NULL,
    `activeAssetId` VARCHAR(191) NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Conversation_userId_type_deletedAt_lastMessageAt_idx`(`userId`, `type`, `deletedAt`, `lastMessageAt`),
    INDEX `Conversation_lastMessageAt_idx`(`lastMessageAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT', 'SYSTEM', 'DEVELOPER') NOT NULL,
    `content` LONGTEXT NULL,
    `sequence` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    `attachments` JSON NULL,
    `providerResponseId` VARCHAR(191) NULL,
    `previousResponseId` VARCHAR(191) NULL,
    `rawResponse` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ChatMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `ChatMessage_providerResponseId_idx`(`providerResponseId`),
    UNIQUE INDEX `ChatMessage_conversationId_sequence_key`(`conversationId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImageTurn` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `prompt` LONGTEXT NOT NULL,
    `status` ENUM('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `params` JSON NOT NULL,
    `referenceAssetIds` JSON NULL,
    `outputAssetIds` JSON NULL,
    `baseAssetId` VARCHAR(191) NULL,
    `activeAssetId` VARCHAR(191) NULL,
    `maskAssetId` VARCHAR(191) NULL,
    `providerRequest` JSON NULL,
    `providerResponse` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ImageTurn_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    UNIQUE INDEX `ImageTurn_conversationId_sequence_key`(`conversationId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `kind` ENUM('CHAT_INPUT', 'IMAGE_REFERENCE', 'IMAGE_OUTPUT', 'IMAGE_MASK') NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `relativePath` VARCHAR(512) NOT NULL,
    `publicPath` VARCHAR(512) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Asset_conversationId_kind_createdAt_idx`(`conversationId`, `kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiUsageLog` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `chatMessageId` VARCHAR(191) NULL,
    `imageTurnId` VARCHAR(191) NULL,
    `kind` ENUM('RESPONSES', 'IMAGE_GENERATION', 'IMAGE_EDIT') NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(191) NOT NULL,
    `statusCode` INTEGER NULL,
    `requestId` VARCHAR(191) NULL,
    `durationMs` INTEGER NULL,
    `usage` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApiUsageLog_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `ApiUsageLog_kind_createdAt_idx`(`kind`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Conversation` ADD CONSTRAINT `Conversation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ImageTurn` ADD CONSTRAINT `ImageTurn_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiUsageLog` ADD CONSTRAINT `ApiUsageLog_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiUsageLog` ADD CONSTRAINT `ApiUsageLog_chatMessageId_fkey` FOREIGN KEY (`chatMessageId`) REFERENCES `ChatMessage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiUsageLog` ADD CONSTRAINT `ApiUsageLog_imageTurnId_fkey` FOREIGN KEY (`imageTurnId`) REFERENCES `ImageTurn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
