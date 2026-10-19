using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RelicHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "version",
                table: "capsule_wallet",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "ck_relic_friend_not_self",
                table: "relic_friend",
                sql: "user_id <> friend_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_collection_item_count",
                table: "collection_item",
                sql: "count >= 1");

            migrationBuilder.AddCheckConstraint(
                name: "ck_capsule_wallet_stock",
                table: "capsule_wallet",
                sql: "stored >= 0 AND premium_stored >= 0 AND essence >= 0 AND since_epic >= 0 AND total_opened >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_relic_friend_not_self",
                table: "relic_friend");

            migrationBuilder.DropCheckConstraint(
                name: "ck_collection_item_count",
                table: "collection_item");

            migrationBuilder.DropCheckConstraint(
                name: "ck_capsule_wallet_stock",
                table: "capsule_wallet");

            migrationBuilder.DropColumn(
                name: "version",
                table: "capsule_wallet");
        }
    }
}
