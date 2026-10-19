using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <summary>
    /// Changement des raretés (champions au palier le plus rare, skins un palier plus bas) : les collections obtenues
    /// avec l'ancien barème sont effacées. Chaque joueur ayant déjà ouvert une relique repart de zéro avec 5 reliques.
    /// Irréversible : les collections supprimées ne sont pas restaurées.
    /// </summary>
    public partial class ResetRelicsForRarityShift : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE capsule_wallet SET
                    stored = 5, premium_stored = 0, essence = 0, total_opened = 0, since_epic = 0,
                    full_notified = false, accrual_anchor = now()
                WHERE total_opened > 0
                   OR user_id IN (SELECT user_id FROM collection_item)
                   OR user_id IN (SELECT user_id FROM capsule_drop);
                DELETE FROM collection_item;
                DELETE FROM capsule_drop;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
