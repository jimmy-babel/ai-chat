-- AlterTable
ALTER TABLE `ApiUsageLog` ADD COLUMN `videoTurnId` VARCHAR(191) NULL,
    MODIFY `kind` ENUM('RESPONSES', 'IMAGE_GENERATION', 'IMAGE_EDIT', 'VIDEO_GENERATION', 'VIDEO_STATUS') NOT NULL;

-- AlterTable
ALTER TABLE `Asset` ADD COLUMN `model` VARCHAR(191) NULL,
    ADD COLUMN `provider` VARCHAR(64) NULL,
    ADD COLUMN `remoteUrl` TEXT NULL,
    MODIFY `kind` ENUM('CHAT_INPUT', 'IMAGE_REFERENCE', 'IMAGE_OUTPUT', 'IMAGE_MASK', 'VIDEO_REFERENCE', 'VIDEO_OUTPUT') NOT NULL;

-- AlterTable
ALTER TABLE `Conversation` MODIFY `type` ENUM('CHAT', 'IMAGE', 'VIDEO') NOT NULL;

-- CreateTable
CREATE TABLE `VideoTurn` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `clientRequestId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(32) NOT NULL,
    `prompt` LONGTEXT NOT NULL,
    `status` ENUM('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `params` JSON NOT NULL,
    `referenceAssetIds` JSON NULL,
    `taskId` VARCHAR(191) NULL,
    `videoId` VARCHAR(191) NULL,
    `remoteUrl` TEXT NULL,
    `outputAssetId` VARCHAR(191) NULL,
    `providerRequest` JSON NULL,
    `providerResponse` JSON NULL,
    `errorMessage` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VideoTurn_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    INDEX `VideoTurn_videoId_idx`(`videoId`),
    UNIQUE INDEX `VideoTurn_conversationId_clientRequestId_key`(`conversationId`, `clientRequestId`),
    UNIQUE INDEX `VideoTurn_conversationId_sequence_key`(`conversationId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VideoTurn` ADD CONSTRAINT `VideoTurn_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiUsageLog` ADD CONSTRAINT `ApiUsageLog_videoTurnId_fkey` FOREIGN KEY (`videoTurnId`) REFERENCES `VideoTurn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
