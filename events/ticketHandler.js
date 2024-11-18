const { ticketsCollection } = require('../mongodb');
const { 
    EmbedBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    PermissionsBitField, 
    ChannelType 
} = require('discord.js');
const ticketIcons = require('../UI/icons/ticketicons');

let config = {};

// Load configuration from the database
async function loadConfig() {
    try {
        const tickets = await ticketsCollection.find({}).toArray();
        config.tickets = tickets.reduce((acc, ticket) => {
            acc[ticket.serverId] = {
                ticketChannelId: ticket.ticketChannelId,
                adminRoleId: ticket.adminRoleId,
                status: ticket.status
            };
            return acc;
        }, {});
    } catch (err) {
        console.error('Error loading config from MongoDB:', err);
    }
}

// Monitor configuration changes and update ticket channels
async function monitorConfigChanges(client) {
    let previousConfig = JSON.parse(JSON.stringify(config));

    setInterval(async () => {
        await loadConfig();
        if (JSON.stringify(config) !== JSON.stringify(previousConfig)) {
            for (const guildId of Object.keys(config.tickets)) {
                const settings = config.tickets[guildId];
                const previousSettings = previousConfig.tickets[guildId];

                if (settings && settings.status && settings.ticketChannelId && (!previousSettings || settings.ticketChannelId !== previousSettings.ticketChannelId)) {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    const ticketChannel = guild.channels.cache.get(settings.ticketChannelId);
                    if (!ticketChannel) continue;

                    const embed = new EmbedBuilder()
                        .setAuthor({ name: "Ticket", iconURL: ticketIcons.mainIcon })
                        .setDescription(
                            `- Please click below to create a new ticket.\n\n**Ticket Guidelines:**\n` +
                            `- To apply as grinder, click on ⛏️ Apply as Grinder.\n` +
                            `- To apply as PVPER, click on ⚔️ Apply as PVPER.`
                        )
                        .setFooter({ text: 'Made by Brand Mine Gamer', iconURL: ticketIcons.modIcon })
                        .setColor('#00FF00')
                        .setTimestamp();

                    const menu = new StringSelectMenuBuilder()
                        .setCustomId('select_ticket_type')
                        .setPlaceholder('Choose ticket type')
                        .addOptions([
                            { label: '⚔️ Apply as PVPER', value: 'apply_as_pvper' },
                            { label: '⛏️ Apply as Grinder', value: 'apply_grinder' }
                        ]);

                    const row = new ActionRowBuilder().addComponents(menu);

                    await ticketChannel.send({ embeds: [embed], components: [row] });

                    previousConfig = JSON.parse(JSON.stringify(config));
                }
            }
        }
    }, 5000);
}

// Handle ticket type selection
async function handleSelectMenu(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { guild, user, values } = interaction;
    if (!guild || !user) return;

    const guildId = guild.id;
    const userId = user.id;
    const ticketType = values[0];
    const settings = config.tickets[guildId];
    if (!settings) return;

    const existingTicket = await ticketsCollection.findOne({ guildId, userId });
    if (existingTicket) {
        return interaction.followUp({ content: 'You already have an open ticket.', ephemeral: true });
    }

    const ticketChannel = await guild.channels.create({
        name: `${user.username}-${ticketType}-ticket`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: settings.adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    const ticketId = `${guildId}-${ticketChannel.id}`;
    await ticketsCollection.insertOne({ id: ticketId, channelId: ticketChannel.id, guildId, userId, type: ticketType });

    const ticketEmbed = new EmbedBuilder()
        .setAuthor({ name: "Support Ticket", iconURL: ticketIcons.modIcon })
        .setDescription(
            `Hello ${user}, welcome to support!\n` +
            `- Please provide a detailed description of your issue.\n` +
            `- Our team will assist you shortly.`
        )
        .setFooter({ text: 'Your satisfaction is our priority', iconURL: ticketIcons.heartIcon })
        .setColor('#00FF00')
        .setTimestamp();

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketId}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(closeButton);

    await ticketChannel.send({ content: `${user}`, embeds: [ticketEmbed], components: [actionRow] });
    interaction.followUp({ content: 'Ticket created!', ephemeral: true });
}

// Handle ticket closure
async function handleCloseButton(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const ticketId = interaction.customId.replace('close_ticket_', '');
    const ticket = await ticketsCollection.findOne({ id: ticketId });
    if (!ticket) return interaction.followUp({ content: 'Ticket not found.', ephemeral: true });

    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) await ticketChannel.delete().catch(console.error);

    await ticketsCollection.deleteOne({ id: ticketId });

    const ticketUser = await client.users.fetch(ticket.userId);
    if (ticketUser) {
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({ name: "Ticket Closed!", iconURL: ticketIcons.correctIcon })
            .setDescription("- Your ticket has been closed. Thank you!")
            .setFooter({ text: 'Thank you for your feedback!', iconURL: ticketIcons.modIcon });

        const ratingMenu = new StringSelectMenuBuilder()
            .setCustomId(`rate_ticket_${ticketId}`)
            .setPlaceholder('Rate your experience')
            .addOptions([
                { label: '⭐ Very Bad', value: '1' },
                { label: '⭐⭐ Bad', value: '2' },
                { label: '⭐⭐⭐ Average', value: '3' },
                { label: '⭐⭐⭐⭐ Good', value: '4' },
                { label: '⭐⭐⭐⭐⭐ Excellent', value: '5' }
            ]);

        const actionRow = new ActionRowBuilder().addComponents(ratingMenu);

        await ticketUser.send({
            content: "Please rate your experience:",
            embeds: [embed],
            components: [actionRow]
        });
    }

    interaction.followUp({ content: 'Ticket closed and user notified.', ephemeral: true });
}

// Handle ticket rating
async function handleRating(interaction) {
    const rating = interaction.values[0];
    const ticketId = interaction.customId.replace('rate_ticket_', '');

    // Update ticket rating in the database
    await ticketsCollection.updateOne({ id: ticketId }, { $set: { rating: parseInt(rating, 10) } });

    // Acknowledge the user
    await interaction.reply({
        content: `Thank you for your feedback! You rated us ${rating} ⭐.`,
        ephemeral: true
    });

    // Fetch the log channel directly by ID (since interaction.guild is not available in DMs)
    const logChannelId = "1303231539773181966"; // Replace with your actual log channel ID
    try {
        const logChannel = await interaction.client.channels.fetch(logChannelId);
        if (logChannel?.isTextBased()) {
            const logEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle("New Ticket Rating")
                .setDescription(`User **${interaction.user.tag}** rated ticket \`${ticketId}\`: **${rating} ⭐**`)
                .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
        }
    } catch (err) {
        console.error("Error logging the ticket rating:", err);
    }
}
