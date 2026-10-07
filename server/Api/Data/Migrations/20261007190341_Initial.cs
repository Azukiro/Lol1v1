using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "series",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    best_of = table.Column<int>(type: "integer", nullable: false),
                    champion_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    spell_mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    win_expression = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    winner_player_id = table.Column<Guid>(type: "uuid", nullable: true),
                    draw_seed = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    finished_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_series", x => x.id);
                    table.CheckConstraint("ck_series_best_of", "best_of IN (1,3,5,7,9,11)");
                });

            migrationBuilder.CreateTable(
                name: "user",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    password_hash = table.Column<string>(type: "text", nullable: false),
                    display_name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_user", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "ban",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    series_id = table.Column<Guid>(type: "uuid", nullable: false),
                    by_player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    target_player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    champion_id = table.Column<int>(type: "integer", nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_ban", x => x.id);
                    table.ForeignKey(
                        name: "fk_ban_series_series_id",
                        column: x => x.series_id,
                        principalTable: "series",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "round",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    series_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<int>(type: "integer", nullable: false),
                    attempt = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    void_reason = table.Column<string>(type: "text", nullable: true),
                    lol_game_id = table.Column<long>(type: "bigint", nullable: true),
                    winner_player_id = table.Column<Guid>(type: "uuid", nullable: true),
                    winning_condition = table.Column<string>(type: "jsonb", nullable: true),
                    void_requested_by = table.Column<Guid>(type: "uuid", nullable: true),
                    dispute_vote_a = table.Column<string>(type: "text", nullable: true),
                    dispute_vote_b = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_round", x => x.id);
                    table.ForeignKey(
                        name: "fk_round_series_series_id",
                        column: x => x.series_id,
                        principalTable: "series",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "invitation",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    from_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    to_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    config = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    series_id = table.Column<Guid>(type: "uuid", nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_invitation", x => x.id);
                    table.ForeignKey(
                        name: "fk_invitation_user_from_user_id",
                        column: x => x.from_user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_invitation_user_to_user_id",
                        column: x => x.to_user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "riot_account",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    puuid = table.Column<string>(type: "text", nullable: false),
                    game_name = table.Column<string>(type: "text", nullable: false),
                    tag_line = table.Column<string>(type: "text", nullable: false),
                    riot_id_normalized = table.Column<string>(type: "text", nullable: false),
                    region = table.Column<string>(type: "text", nullable: false),
                    linked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_riot_account", x => x.id);
                    table.ForeignKey(
                        name: "fk_riot_account_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "observation",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    round_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reported_by_player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    event_id = table.Column<string>(type: "text", nullable: false),
                    event_time = table.Column<double>(type: "double precision", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false),
                    subject_player_id = table.Column<Guid>(type: "uuid", nullable: true),
                    value = table.Column<int>(type: "integer", nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_observation", x => x.id);
                    table.ForeignKey(
                        name: "fk_observation_round_round_id",
                        column: x => x.round_id,
                        principalTable: "round",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "round_assignment",
                columns: table => new
                {
                    round_id = table.Column<Guid>(type: "uuid", nullable: false),
                    player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    champion_id = table.Column<int>(type: "integer", nullable: true),
                    spell1id = table.Column<int>(type: "integer", nullable: true),
                    spell2id = table.Column<int>(type: "integer", nullable: true),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revealed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    reported_champion_id = table.Column<int>(type: "integer", nullable: true),
                    reported_spell1id = table.Column<int>(type: "integer", nullable: true),
                    reported_spell2id = table.Column<int>(type: "integer", nullable: true),
                    reported_locked = table.Column<bool>(type: "boolean", nullable: false),
                    game_started_reported = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_round_assignment", x => new { x.round_id, x.player_id });
                    table.ForeignKey(
                        name: "fk_round_assignment_round_round_id",
                        column: x => x.round_id,
                        principalTable: "round",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "series_player",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    series_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    riot_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    slot = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    rounds_won = table.Column<int>(type: "integer", nullable: false),
                    pool_snapshot = table.Column<string>(type: "jsonb", nullable: true),
                    pool_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    deck_locked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    spell_budget_locked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_series_player", x => x.id);
                    table.ForeignKey(
                        name: "fk_series_player_riot_account_riot_account_id",
                        column: x => x.riot_account_id,
                        principalTable: "riot_account",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_series_player_series_series_id",
                        column: x => x.series_id,
                        principalTable: "series",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_series_player_user_user_id",
                        column: x => x.user_id,
                        principalTable: "user",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "deck_champion",
                columns: table => new
                {
                    series_player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    champion_id = table.Column<int>(type: "integer", nullable: false),
                    banned = table.Column<bool>(type: "boolean", nullable: false),
                    consumed_in_round_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_deck_champion", x => new { x.series_player_id, x.champion_id });
                    table.ForeignKey(
                        name: "fk_deck_champion_series_player_series_player_id",
                        column: x => x.series_player_id,
                        principalTable: "series_player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "spell_token",
                columns: table => new
                {
                    series_player_id = table.Column<Guid>(type: "uuid", nullable: false),
                    spell_id = table.Column<int>(type: "integer", nullable: false),
                    quantity_initial = table.Column<int>(type: "integer", nullable: false),
                    quantity_left = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_spell_token", x => new { x.series_player_id, x.spell_id });
                    table.ForeignKey(
                        name: "fk_spell_token_series_player_series_player_id",
                        column: x => x.series_player_id,
                        principalTable: "series_player",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ban_series_id_by_player_id_champion_id",
                table: "ban",
                columns: new[] { "series_id", "by_player_id", "champion_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_invitation_from_user_id",
                table: "invitation",
                column: "from_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_invitation_to_user_id_status",
                table: "invitation",
                columns: new[] { "to_user_id", "status" });

            migrationBuilder.CreateIndex(
                name: "ix_observation_round_id_reported_by_player_id_type_event_id",
                table: "observation",
                columns: new[] { "round_id", "reported_by_player_id", "type", "event_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_riot_account_puuid",
                table: "riot_account",
                column: "puuid",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_riot_account_riot_id_normalized",
                table: "riot_account",
                column: "riot_id_normalized");

            migrationBuilder.CreateIndex(
                name: "ix_riot_account_user_id",
                table: "riot_account",
                column: "user_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_round_series_id_number_attempt",
                table: "round",
                columns: new[] { "series_id", "number", "attempt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_round_status",
                table: "round",
                column: "status");

            migrationBuilder.CreateIndex(
                name: "ix_series_player_riot_account_id",
                table: "series_player",
                column: "riot_account_id");

            migrationBuilder.CreateIndex(
                name: "ix_series_player_series_id_slot",
                table: "series_player",
                columns: new[] { "series_id", "slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_series_player_user_id",
                table: "series_player",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_user_email",
                table: "user",
                column: "email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ban");

            migrationBuilder.DropTable(
                name: "deck_champion");

            migrationBuilder.DropTable(
                name: "invitation");

            migrationBuilder.DropTable(
                name: "observation");

            migrationBuilder.DropTable(
                name: "round_assignment");

            migrationBuilder.DropTable(
                name: "spell_token");

            migrationBuilder.DropTable(
                name: "round");

            migrationBuilder.DropTable(
                name: "series_player");

            migrationBuilder.DropTable(
                name: "riot_account");

            migrationBuilder.DropTable(
                name: "series");

            migrationBuilder.DropTable(
                name: "user");
        }
    }
}
