import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeChainIdToInt1761115157618 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Drop the composite unique index first
        await queryRunner.query(`
            ALTER TABLE \`users\`
            DROP INDEX \`IDX_5645ea77249a0e72ae28108c9c\`
        `);

        // Change chainId from varchar to int
        await queryRunner.query(`
            ALTER TABLE \`users\`
            MODIFY COLUMN \`chainId\` int NOT NULL
        `);

        // Recreate the composite unique index
        await queryRunner.query(`
            ALTER TABLE \`users\`
            ADD UNIQUE INDEX \`IDX_address_chainId\` (\`address\`, \`chainId\`)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop the composite unique index
        await queryRunner.query(`
            ALTER TABLE \`users\`
            DROP INDEX \`IDX_address_chainId\`
        `);

        // Change chainId back to varchar
        await queryRunner.query(`
            ALTER TABLE \`users\`
            MODIFY COLUMN \`chainId\` varchar(255) NOT NULL
        `);

        // Recreate the original composite unique index
        await queryRunner.query(`
            ALTER TABLE \`users\`
            ADD UNIQUE INDEX \`IDX_5645ea77249a0e72ae28108c9c\` (\`address\`, \`chainId\`)
        `);
    }

}
