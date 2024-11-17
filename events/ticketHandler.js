const { ticketsCollection } = require('../mongodb');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const ticketIcons = require('../UI/icons/ticketicons');

let config = {};

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
        //console.error('Error loading config from MongoDB:', err);
    }
}

setInterval(loadConfig, 5000);

module.exports = (client) => {
    client.on('ready', async () => {
        await loadConfig();
        monitorConfigChanges(client);
    });

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
            handleSelectMenu(interaction, client);
        } else if (interaction.isButton() && interaction.customId.startsWith('close_ticket_')) {
            handleCloseButton(interaction, client);
        }
    });
};

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
                        .setAuthor({
                            name: "Ticket",
                            iconURL: ticketIcons.mainIcon,
                            url: "https://discord.gg/xQF9f9yUEM"
                        })
                        .setDescription('- Please click below menu to create a new ticket.\n\n' +
                            '**Ticket Guidelines:**\n' +
                            '- To apply as grinder click on ⛏️Apply as Grinder.\n' +
                            '- To apply as PVPER click on ⚔️Apply as PVPER')
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

                    await ticketChannel.send({
                        embeds: [embed],
                        components: [row]
                    });

                    previousConfig = JSON.parse(JSON.stringify(config));
                }
            }
        }
    }, 5000);
}

async function handleSelectMenu(interaction, client) {
    await interaction.deferReply({ ephemeral: true }); 

    const { guild, user, values } = interaction;
    if (!guild || !user) return;

    const guildId = guild.id;
    const userId = user.id;
    const ticketType = values[0];
    const settings = config.tickets[guildId];
    if (!settings) return;

    const ticketExists = await ticketsCollection.findOne({ guildId, userId });
    if (ticketExists) {
        return interaction.followUp({ content: 'You already have an open ticket.', ephemeral: true });
    }

    const ticketChannel = await guild.channels.create({
        name: `${user.username}-${ticketType}-ticket`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: userId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
            },
            {
                id: settings.adminRoleId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
            }
        ]
    });

    const ticketId = `${guildId}-${ticketChannel.id}`;
    await ticketsCollection.insertOne({ id: ticketId, channelId: ticketChannel.id, guildId, userId, type: ticketType });

    const ticketEmbed = new EmbedBuilder()
        .setAuthor({
            name: "Support Ticket",
            iconURL: ticketIcons.modIcon,
            url: "https://discord.gg/xQF9f9yUEM"
        })
        .setDescription(`Hello ${user}, welcome to our support!\n- Please provide a detailed description of your issue\n- Our support team will assist you as soon as possible.\n- Feel free to open another ticket if this was closed.`)
        .setFooter({ text: 'Your satisfaction is our priority', iconURL: ticketIcons.heartIcon })
        .setColor('#00FF00')
        .setTimestamp();

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketId}`)
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger);

    const actionRow = new ActionRowBuilder().addComponents(closeButton);

    await ticketChannel.send({ content: `${user}`, embeds: [ticketEmbed], components: [actionRow] });

    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setAuthor({ 
            name: "Ticket Created!", 
            iconURL: ticketIcons.correctIcon,
            url: "https://discord.gg/xQF9f9yUEM"
        })
        .setDescription(`- Your ${ticketType} ticket has been created.`)
        .addFields(
            { name: 'Ticket Channel', value: `${ticketChannel.url}` },
            { name: 'Instructions', value: 'Please describe your issue in detail.' }
        )
        .setTimestamp()
        .setFooter({ text: 'Thank you for reaching out!', iconURL: ticketIcons.modIcon });

    await user.send({ content: `Your ${ticketType} ticket has been created`, embeds: [embed] });

    interaction.followUp({ content: 'Ticket created!', ephemeral: true });
}

async function handleCloseButton(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const ticketId = interaction.customId.replace('close_ticket_', '');
    const { guild, user } = interaction;
    if (!guild || !user) return;

    const ticket = await ticketsCollection.findOne({ id: ticketId });
    if (!ticket) {
        return interaction.followUp({ content: 'Ticket not found. Please report to staff!', ephemeral: true });
    }

    const ticketChannel = guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
        setTimeout(async () => {
            await ticketChannel.delete().catch(console.error);
        }, 5000);
    }

    await ticketsCollection.deleteOne({ id: ticketId });

    const ticketUser = await client.users.fetch(ticket.userId);
    if (ticketUser) {
        // Embed for the ticket closure notification
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setAuthor({
                name: "Ticket Closed!",
                iconURL: ticketIcons.correctIcon,
                url: "https://discord.gg/xQF9f9yUEM"
            })
            .setDescription("- Your ticket has been closed. Thank you for reaching out to us!")
            .setTimestamp()
            .setFooter({ text: "Thank you for your feedback!", iconURL: ticketIcons.modIcon });

        // Rating system dropdown menu
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

        // Send the rating request to the user
        await ticketUser.send({
            content: "We would love to hear your feedback! Please rate your experience below:",
            embeds: [embed],
            components: [actionRow]
        });
    }

    interaction.followUp({ content: 'Ticket closed and user notified.', ephemeral: true });
}

// Rating system interaction handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('rate_ticket_')) {
        const rating = interaction.values[0];
        const ticketId = interaction.customId.replace('rate_ticket_', '');

        // Log or store the rating in the database
        await ticketsCollection.updateOne(
            { id: ticketId },
            { $set: { rating: parseInt(rating, 10) } }
        );

        await interaction.reply({
            content: `Thank you for your feedback! You rated us ${rating} ⭐.`,
            ephemeral: true
        });

        // Optionally: notify admins or log ratings in a specific channel
        const logChannel = interaction.guild.channels.cache.find(ch => ch.name === "ratings-log");
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle("New Ticket Rating")
                .setDescription(`User **${interaction.user.tag}** rated ticket \`${ticketId}\`: **${rating} ⭐**`)
                .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
        }
    }
});
